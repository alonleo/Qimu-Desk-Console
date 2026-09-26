import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
const require = createRequire(import.meta.url);
function load(path, mocks = {}, globals = {}) {
  const source = readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
  const context = { exports: {}, require: (id) => id in mocks ? mocks[id] : require(id), process, Buffer, URL, AbortSignal, ...globals };
  vm.createContext(context);
  vm.runInContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, context);
  return context.exports;
}
const schema = load('core/ai/capability-schema.ts');
const skill = schema.parseCapability({ kind: 'skill', source: '\uFEFF---\r\nname: editor\r\ndescription: 编辑\r\n---\r\n请检查文字。' });
assert.equal(skill.config.skills[0].instructions, '请检查文字。');
assert.throws(() => schema.parseCapability({ kind: 'skill', source: 'no metadata' }));
assert.throws(() => schema.parseCapability({ kind: 'plugin', source: '{"name":"empty"}' }));
assert.throws(() => schema.parseCapability({ kind: 'mcp', source: '{"name":"bad","url":"file:///etc/passwd"}' }));
assert.throws(() => schema.parseCapability({ kind: 'mcp', source: '{"name":"bad","url":"https://example.com","headers":{"Host":"internal"}}' }));
assert.throws(() => schema.parseCapability({ kind: 'mcp', source: '{"name":"bad","url":"https://user:secret@example.com"}' }));
const bundle = schema.parseCapability({ kind: 'plugin', source: JSON.stringify({ name: 'bundle', skills: [{ name: 'writer', instructions: 'write' }], mcpServers: [{ name: 'tools', url: 'https://example.com/mcp', headers: { Authorization: 'Bearer private' } }] }) });
assert.equal(bundle.config.skills.length, 1); assert.equal(bundle.config.mcpServers.length, 1);

// Real encryption + SQL bindings, with an in-memory database adapter.
process.env.AI_CAPABILITY_SECRET = 'test-only-secret-at-least-32-characters-long';
let stored; let inserted;
const store = load('core/ai/capabilities.ts', {
  './capability-schema': schema,
  '@/core/db': {
    exec: async (sql, args) => {
      if (sql.startsWith('INSERT')) { inserted = args; stored = { id: 1, kind: args[1], name: args[2], description: args[3], config: args[4], enabled: 1 }; }
      return { insertId: 1, changes: 1 };
    },
    row: async (sql, args) => sql.includes('COUNT') ? { count: 0 } : args?.[1] === 7 ? stored : null,
    rows: async (_, args) => args[0] === 7 ? [stored] : [],
  },
});
await store.createCapability(7, { kind: 'mcp', source: JSON.stringify({ name: 'tools', url: 'https://example.com/mcp', headers: { Authorization: 'Bearer private' } }) });
assert.equal(inserted[0], 7); assert.ok(!stored.config.includes('private'));
assert.equal((await store.getCapability(7, 1)).config.mcpServers[0].headers.Authorization, 'Bearer private');
assert.equal(await store.getCapability(8, 1), null);
assert.ok(!JSON.stringify(await store.listCapabilities(7)).includes('private'));
assert.ok(!('config' in (await store.listCapabilities(7))[0]));

const llm = load("core/llm.ts", { "./db": {} });
let finishReasons = [];
let executed = 0; let requests = []; let answers = []; let toolProgress = [];
const runtime = load('core/ai/tool-chat.ts', {
  '@/core/llm': { aiReady: () => true, completionsUrl: () => 'https://example.invalid/chat/completions', generationOptions: llm.generationOptions },
  './capabilities': { getCapability: async (userId, id) => userId === 7 && id === 1 ? { enabled: true, config: skill.config } : null },
  './mcp': { connectMcp: () => { throw new Error('must not connect'); } },
  '@/core/skills': { getSkillDetail: async () => null },
  '@/core/visibility': { canReadRow: () => false },
}, { fetch: async (_, opts) => { requests.push(JSON.parse(opts.body)); return Response.json({ choices: [{ message: answers.shift(), finish_reason: finishReasons.shift() }] }); } });
const tool = { name: 'echo', label: 'Echo', description: 'echo input', parameters: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false }, execute: async (args) => { executed++; return { output: args.value }; } };
const opts = { cfg: { model: 'test', api_key: 'test' }, messages: [{ role: 'user', content: 'hi' }], tools: [tool], signal: new AbortController().signal, onTool: (run) => toolProgress.push(run) };
const call = (name, args, id = 'call-1') => ({ role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
answers = [call('echo', { value: '实际结果' }), { role: 'assistant', content: '已完成' }];
const result = await runtime.chatWithTools(opts);
assert.equal(executed, 1); assert.equal(result.content, '已完成');
assert.equal(toolProgress[0].status, 'running'); assert.equal(toolProgress[1].status, 'success');
assert.equal(requests[1].messages.at(-1).content, '实际结果');
answers = [call('echo', { value: 3 }), { role: 'assistant', content: '参数无效' }];
await runtime.chatWithTools(opts); assert.equal(executed, 1, 'invalid arguments cannot execute');
answers = [call('not_selected', {}), { role: 'assistant', content: '无权限' }];
await runtime.chatWithTools(opts); assert.equal(executed, 1, 'unselected tools cannot execute');
answers = [call('echo', { value: 'a' }), call('echo', { value: 'a' })];
await assert.rejects(runtime.chatWithTools(opts), /重复/); assert.equal(executed, 2, 'duplicate call IDs cannot repeat actions');
const cancelled = new AbortController(); cancelled.abort();
await assert.rejects(runtime.chatWithTools({ ...opts, signal: cancelled.signal }));
const prepared = await runtime.prepareCapabilities({ user: { id: 7 }, ids: [1], skillIds: [], allowTools: false, signal: opts.signal });
assert.equal(prepared.instructions.length, 1); assert.equal(prepared.tools.length, 0); await prepared.close();
await assert.rejects(runtime.prepareCapabilities({ user: { id: 8 }, ids: [1], skillIds: [], allowTools: true, signal: opts.signal }), /不存在/);
console.log('PASS: Skill/plugin parsing, invalid config, encrypted credentials, owner isolation, function calling, schema validation, tool allowlist, duplicate prevention, abort, instruction-only mode');

requests = []; answers = [{...call('echo',{value:'result'}), reasoning_content:'private-reasoning', reasoning_details:[{text:'private-reasoning'}]}, {role:'assistant',content:'完成'}];
await runtime.chatWithTools({...opts,cfg:{...opts.cfg,model:'MiniMax-M3'}});
assert.equal(requests[0].max_tokens,16384);assert.equal(requests[0].reasoning_split,true);
assert.equal(requests[1].messages.at(-2).reasoning_content,'private-reasoning');
assert.equal(requests[1].messages.at(-2).reasoning_details[0].text,'private-reasoning');
const before=executed;answers=[call('echo',{value:'do not execute'})];finishReasons=['length'];
await assert.rejects(runtime.chatWithTools(opts),/长度上限/);assert.equal(executed,before);
console.log('PASS: MiniMax tool reasoning continuity; truncated tool requests never execute');
