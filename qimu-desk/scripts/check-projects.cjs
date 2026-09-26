const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(file, dependencies) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const js = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020}}).outputText;
  const module = {exports: {}};
  vm.runInNewContext(js, {module, exports: module.exports, require: name => {
    if (name in dependencies) return dependencies[name];
    throw new Error(`Unexpected dependency: ${name}`);
  }, Request, Response, URL, console});
  return module.exports;
}
const visibility = load('core/visibility.ts', {});
const schemas = load('core/schemas.ts', {zod: require('zod')});
(async () => {
  let query;
  const projects = load('core/projects.ts', {'./db': {rows: async (sql, params) => {query = {sql, params}; return [];}}, './visibility': visibility});
  await projects.listProjects({id: 7, role:'member'}, true);
  assert.match(query.sql, /t\.visibility = 'public' OR t\.owner_id = \?/);
  assert.match(query.sql, /p\.visibility = 'public' OR p\.owner_id = \?/);
  assert.equal(JSON.stringify(query.params), '[7,7]');
  assert.doesNotMatch(query.sql, /status != 'archived'/);
  await projects.listProjects({id: 1, role:'admin'});
  assert.match(query.sql, /p\.status != 'archived'/);
  assert.equal(query.params.length, 0);
  assert.equal(schemas.projectCreateSchema.safeParse({name:'   '}).success, false);
  assert.equal(schemas.projectUpdateSchema.safeParse({status:'active'}).success, true);
  assert.equal(schemas.projectUpdateSchema.safeParse({status:'invalid'}).success, false);

  let actor = {id: 7, role:'member'};
  let record = {id: 2, owner_id: 8, visibility:'public'};
  let writes = [];
  let transactions = 0;
  const db = {
    row: async () => record,
    exec: async (sql, params) => {writes.push({sql, params}); return {changes:1};},
    withTransaction: async fn => {transactions++; return fn(db);},
  };
  const routes = load('app/api/projects/[id]/route.ts', {
    'next/server': {NextResponse: {json: (body, options) => ({body, status: options?.status || 200})}},
    '@/core/db': db,
    '@/core/api': {requireUser: async () => actor, jsonError: (error, status) => ({body:{error},status}), readJson: req => req.json(), assertOrigin: () => true},
    '@/core/schemas': schemas,
    '@/core/visibility': visibility,
  });
  const context = {params: Promise.resolve({id:'2'})};
  const request = body => new Request('http://localhost/api/projects/2', {method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
  assert.equal((await routes.PATCH(request({name:'Forbidden'}), context)).status, 403);
  assert.equal(writes.length, 0);
  assert.equal((await routes.DELETE(new Request('http://localhost/api/projects/2'), context)).status, 403);
  assert.equal(transactions, 0);
  record.owner_id = 7;
  assert.equal((await routes.PATCH(request({visibility:'personal',status:'active'}), context)).status, 200);
  assert.match(writes[0].sql, /visibility = \?/);
  assert.match(writes[0].sql, /status = \?/);
  writes = [];
  assert.equal((await routes.DELETE(new Request('http://localhost/api/projects/2'), context)).status, 200);
  assert.equal(transactions, 1);
  assert.match(writes[0].sql, /UPDATE tasks SET project_id = NULL/);
  assert.match(writes[1].sql, /DELETE FROM projects/);
  actor = null;
  assert.equal((await routes.PATCH(request({status:'active'}), context)).status, 401);
  console.log('PASS: scoped statistics, archived inclusion, validation, owner permissions, visibility/status updates, transactional task unlinking, authentication');
})().catch(error => {console.error(error); process.exitCode = 1;});
