const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, deps = {}) {
  const module = { exports: {} };
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(js, { module, exports: module.exports, Request, Response, AbortController, AbortSignal, TextEncoder, ReadableStream, setInterval, clearInterval, require: name => {
    if (name in deps) return deps[name];
    throw new Error(`Unexpected dependency: ${name}`);
  } });
  return module.exports;
}
const schemas = load('core/schemas.ts', { zod: require('zod') });
const commands = load('core/ai/commands.ts');
const workspace = load('core/ai/workspace-tools.ts');
let captured, toolMode;
const routes = load('app/api/ai/chat/route.ts', {
  '@/core/ai/workspace-tools': workspace,
  '@/core/ai/workspace-api': { workspaceTransport: () => async () => ({ ok: true, data: {} }) },
  '@/core/ai/tool-chat': { prepareCapabilities: async opts => { toolMode = opts.allowTools; return { tools: [], instructions: [], close: async () => {} }; }, chatWithTools: async opts => { captured = opts; return { content: '工具回复', toolRuns: [] }; } },
  '@/core/visibility': { canReadRow: () => true },
  'next/server': { NextResponse: { json: Response.json } },
  '@/core/api': { assertOrigin: () => true, requireUser: async () => ({ id: 1, username: 'test', role: 'admin' }), readJson: r => r.json(), jsonError: (error, status) => Response.json({ error }, { status }) },
  '@/core/llm': { getAiConfig: async () => ({ id: 1 }), generationTimeout: () => 10000, chatLlm: async opts => { captured = opts; return { ok: true, content: '普通回复' }; } },
  '@/core/knowledge': { listDocs: async () => [] },
  '@/core/schemas': schemas,
  '@/core/ai/artifacts': { extractArtifacts: content => ({ reply: content, drafts: [] }) },
  '@/core/ai/prompts': { ARTIFACT_SYSTEM_PROMPT: '旧技能工作流草稿提示' },
  '@/core/ai/commands': commands,
  '@/core/skills': {}, '@/core/workflows': {},
});
async function request(extra = {}) {
  captured = undefined; toolMode = undefined;
  const res = await routes.POST(new Request('http://localhost/api/ai/chat', { method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: '创建一个项目，名字叫入口回归' }], ...extra }) }));
  if (extra.stream) await res.text(); else await res.json();
  return captured;
}
(async () => {
  assert.equal(schemas.aiChatSchema.parse({ messages: [{ role: 'user', content: '创建项目' }] }).allowToolCalls, true, 'Omitted flag must enable business tools at the default entry');
  for (const extra of [{}, { stream: true }, { allowToolCalls: true }]) {
    const opts = await request(extra);
    assert.equal(toolMode, true);
    assert.deepEqual(Array.from(opts.tools, t => t.name), ['workspace_tasks', 'workspace_projects', 'workspace_knowledge', 'workspace_notices']);
  }
  const disabled = await request({ allowToolCalls: false });
  assert.equal(disabled.tools, undefined, 'Explicitly disabled mode must not execute tools');
  assert.ok(disabled.messages.some(m => m.role === 'system' && m.content.includes('AI 操作') && m.content.includes('关闭')), 'Disabled mode must explain how to enable business actions instead of pretending they do not exist');
  const viewSource = fs.readFileSync(path.join(__dirname, '..', 'components/ai/AIView.tsx'), 'utf8');
  const file = ts.createSourceFile('AIView.tsx', viewSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let retry, hydrate, persist;
  function find(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'regenerate') retry = node.initializer.arguments[0].getText(file);
    if (ts.isCallExpression(node) && node.expression.getText(file) === 'useEffect') {
      const body = node.arguments[0]?.getText(file) || '';
      if (body.includes('setHydrated(true)')) hydrate = body;
      if (body.includes('writeLocalStorage(toolCallsKeyOf')) persist = body;
    }
    ts.forEachChild(node, find);
  }
  find(file);
  assert.ok(retry, 'Regenerate callback must exist');
  assert.ok(hydrate && persist, 'Tool preference must hydrate and persist');
  const runCallback = (source, context) => vm.runInNewContext(ts.transpileModule(`(${source})()`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  const stored = new Map([['tools:1', 'false']]);
  for (const uid of [1, 2]) {
    let restored;
    const context = { userKey: uid, sessionKeyOf: id => `sessions:${id}`, activeKeyOf: id => `active:${id}`, toolCallsKeyOf: id => `tools:${id}`,
      loadSessions: () => [], loadLegacyHistory: () => [], readLocalStorage: key => stored.get(key) ?? null,
      LS_LEGACY_SESSIONS_KEY: 'legacy-sessions', LS_LEGACY_ACTIVE_KEY: 'legacy-active', LS_LEGACY_HISTORY_KEY: 'legacy-history', LS_USE_KNOWLEDGE_KEY: 'knowledge', LS_RAIL_KEY: 'rail',
      setActiveId: () => {}, setUseKnowledge: () => {}, setRailOpen: () => {}, setHydrated: () => {}, setAllowToolCalls: value => { restored = value; } };
    runCallback(hydrate, context);
    assert.equal(restored, uid === 2, 'Refresh must restore the user preference without carrying another account’s disabled state');
    runCallback(persist, { ...context, hydrated: true, allowToolCalls: !restored, writeLocalStorage: (key, value) => stored.set(key, value) });
    assert.equal(stored.get(`tools:${uid}`), String(!restored));
  }
  for (const currentMode of [true, false]) {
    let refs, saved;
    const context = { activeConv: { id: 'test', items: [{ role: 'user', content: '创建项目', allowToolCalls: !currentMode }] }, streaming: null,
      abortRef: { current: null }, picked: { enabled: true }, allowToolCalls: currentMode,
      commitItems: (_id, items) => { saved = items; }, runChat: (_id, _items, options) => { refs = options; } };
    runCallback(retry, context);
    assert.equal(refs.allowToolCalls, currentMode, 'Retry must respect the current switch, not the historical disabled value');
    assert.equal(saved.at(-1).allowToolCalls, currentMode, 'Retried message must retain the effective mode');
  }
  console.log('PASS: default entry, SSE and explicit enable register all business tools; explicit disable is respected and explained; retry follows the current mode');
})().catch(e => { console.error(e); process.exitCode = 1; });
