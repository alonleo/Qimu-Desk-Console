const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const Ajv = require('ajv/dist/2020');
function load(file, dependencies = {}, globals = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(js, { module, exports: module.exports, require: name => {
    if (name in dependencies) return dependencies[name];
    throw new Error(`Unexpected dependency: ${name}`);
  }, Request, Response, URLSearchParams, ...globals });
  return module.exports;
}
(async () => {
  const { workspaceTools } = load('core/ai/workspace-tools.ts');
  const calls = [];
  const tools = workspaceTools(false, async request => { calls.push(request); return { ok: true, data: { id: 12 } }; });
  for (const tool of tools) {
    const validate = new Ajv({ strict: false }).compile(tool.parameters);
    assert.equal(validate({ action: 'list' }), true);
    assert.equal(validate({ action: 'delete', id: -1 }), false);
    assert.equal(validate({ action: 'update', id: 1, data: { owner_id: 2 } }), false);
    assert.equal(validate({ action: 'list', url: 'https://example.com' }), false);
  }
  const task = tools.find(t => t.name === 'workspace_tasks');
  assert.equal((await task.execute({ action: 'update', id: 1, data: {} })).error, true);
  assert.equal((await task.execute({ action: 'delete' })).error, true);
  assert.equal((await task.execute({ action: 'create', data: { title: ' ' } })).error, true);
  assert.equal(calls.length, 0);
  assert.equal((await task.execute({ action: 'update', id: 12, data: { status: 'done' } })).error, false);
  assert.equal(JSON.stringify(calls[0].data), '{"status":"done"}');
  const notice = tools.find(t => t.name === 'workspace_notices');
  assert.equal((await notice.execute({ action: 'delete', id: 1 })).error, true);
  const adminNotice = workspaceTools(true, async () => ({ ok: false, data: { ok: false, error: 'denied' } })).find(t => t.name === 'workspace_notices');
  assert.equal((await adminNotice.execute({ action: 'create', data: { title: 'notice' } })).error, true);
  assert.equal((await adminNotice.execute({ action: 'delete', id: 1 })).error, true);

  let user = { role: 'member' };
  let observed;
  const handler = async (req, ctx) => {
    observed = { method: req.method, url: req.url, id: ctx ? (await ctx.params).id : undefined, data: req.method === 'GET' ? null : await req.json() };
    return Response.json({ ok: true, projects: [{ id: 12 }], docs: [] });
  };
  const deps = {};
  for (const resource of ['projects', 'knowledge', 'notices']) {
    deps[`@/app/api/${resource}/route`] = { GET: handler, POST: handler };
    deps[`@/app/api/${resource}/[id]/route`] = { GET: handler, PATCH: handler, DELETE: handler };
  }
  deps['@/core/auth'] = { currentUser: async () => user, requestToken: async () => 'session-token', backendBaseUrl: () => 'http://backend' };
  deps['@/core/db'] = { row: async () => ({ id: 12, status: 'draft' }) };
  deps['@/core/task-api'] = { taskProxy: async (req, suffix) => { observed = { suffix, method: req.method }; return Response.json({ tasks: [{ id: 12 }] }); } };
  const { workspaceTransport } = load('core/ai/workspace-api.ts', deps, { fetch: async (url, options) => {
    observed = { url, ...options };
    return Response.json({ ok: false, error: '通知不存在' });
  } });
  const transport = workspaceTransport(new AbortController().signal);
  assert.equal((await transport({ resource: 'notices', action: 'delete', id: 12 })).ok, false);
  await transport({ resource: 'knowledge', action: 'create', data: { title: 'doc', content: 'body' } });
  assert.equal(observed.data.source, 'ai');
  await transport({ resource: 'projects', action: 'update', id: 12, data: { name: 'new' } });
  assert.equal(observed.method, 'PATCH');
  assert.equal(observed.id, '12');
  assert.equal((await transport({ resource: 'projects', action: 'get', id: 12 })).ok, true);
  assert.match(observed.url, /includeArchived=1/);
  assert.equal((await transport({ resource: 'tasks', action: 'get', id: 13 })).ok, false);
  await transport({ resource: 'tasks', action: 'delete', id: 12 });
  assert.equal(observed.suffix, '/12');
  await transport({ resource: 'notices', action: 'list', query: { type: 'announcement' } });
  assert.match(observed.url, /tab=announcement/);
  user = { role: 'admin' };
  assert.equal((await transport({ resource: 'notices', action: 'update', id: 12, data: { title: 'edit' } })).ok, false);
  assert.equal(observed.method, 'PUT');
  assert.match(observed.url, /^http:\/\/backend\/api\/notices\/12/);
  assert.equal((await transport({ resource: 'notices', action: 'get', id: 12 })).data.notice.status, 'draft');
  user = null;
  assert.equal((await transport({ resource: 'projects', action: 'delete', id: 12 })).ok, false);
  console.log('PASS: tool schemas, CRUD validation, role boundaries, partial updates, authenticated route dispatch, AI source, archived lookup, backend failures, expired sessions');
})().catch(error => { console.error(error); process.exitCode = 1; });
