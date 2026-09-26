/* Run: node scripts/qa-workflows.cjs. Uses isolated database/API doubles. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
function load(file, mocks) {
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(id => id in mocks ? mocks[id] : require(id), module, module.exports);
  return module.exports;
}
const visibility = load('core/visibility.ts', {});
let query;
const workflow = load('core/workflows.ts', {
  './db': { rows: async (sql, params) => { query = { sql, params }; return []; } },
  './executor': {}, './skills': {}, './llm': {}, './visibility': visibility,
});
let actor = { id: 7, role: 'member', username: 'tester' };
let executed = false;
const route = load('app/api/workflows/[id]/run/route.ts', {
  'next/server': { NextResponse: { json: (data, options) => ({ data, status: options?.status ?? 200 }) } },
  '@/core/api': { requireUser: async () => actor, assertOrigin: () => true, readJson: async () => ({ params: {}, async: true }), jsonError: (error, status) => ({ error, status }) },
  '@/core/visibility': visibility,
  '@/core/workflows': { getWorkflowDetail: async () => ({ workflow: { visibility: 'personal', owner_id: 8 } }), startWorkflowRun: async () => { executed = true; return { runId: 42 }; } },
});
(async () => {
  await workflow.listWorkflowRuns(3, 200, actor, 42);
  assert.match(query.sql, /WHERE 1=1 AND r.workflow_id = \? AND r.id = \? AND \(w.visibility = 'public' OR w.owner_id = \?\)/);
  assert.match(query.sql, /LIMIT 100/);
  assert.deepEqual(query.params, [3, 42, 7]);
  await workflow.listWorkflowRuns(undefined, 10, { id: 1, role: 'admin' });
  assert.doesNotMatch(query.sql, /w.visibility/);
  assert.deepEqual(query.params, []);
  await workflow.listWorkflowRuns(undefined, 10, null);
  assert.deepEqual(query.params, [-1]);
  const request = new Request('http://localhost/api/workflows/3/run', { method: 'POST' });
  const denied = await route.POST(request, { params: Promise.resolve({ id: '3' }) });
  assert.equal(denied.status, 404);
  assert.equal(executed, false);
  actor = { ...actor, id: 8 };
  const allowed = await route.POST(request, { params: Promise.resolve({ id: '3' }) });
  assert.equal(allowed.status, 202);
  assert.equal(executed, true);
  console.log('PASS: member/admin/anonymous history scope, exact run lookup, limit cap, private execution denied, owner execution allowed');
})().catch(error => { console.error(error); process.exitCode = 1; });
