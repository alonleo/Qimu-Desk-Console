const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const path = require('node:path');
let user = null, origin = true, response, forwarded = [];
const exportsUnderTest = {};
const json = (body, options = {}) => ({ body, status: options.status || 200 });
const deps = {
  'next/server': { NextResponse: { json } },
  './auth': { currentUser: async () => user, requestToken: async () => 'test-token', backendBaseUrl: () => 'http://backend.test' },
  './api': { assertOrigin: () => origin, jsonError: (error, status) => json({ error }, { status }) },
};
const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../../core/knowledge-taxonomy.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
vm.runInNewContext(code, { exports: exportsUnderTest, URL, require: (key) => deps[key], fetch: async (url, init) => { forwarded.push({ url, init }); if (response instanceof Error) throw response; return response; } });
const request = (method = 'POST') => ({ url: 'https://desk.test/api/knowledge/tags?name=API%20%E7%BD%91%E5%85%B3', method, text: async () => '{"name":"API"}' });
(async () => {
  const { taxonomyProxy } = exportsUnderTest;
  assert.equal((await taxonomyProxy(request(), 'tags')).status, 401);
  user = { id: 1, role: 'member' };
  assert.equal((await taxonomyProxy(request(), 'categories')).status, 403);
  user.role = 'admin'; origin = false;
  assert.equal((await taxonomyProxy(request(), 'categories')).status, 403);
  assert.equal(forwarded.length, 0);
  origin = true; response = { ok: true, status: 200, json: async () => ({ ok: true, updated: 2 }) };
  assert.equal((await taxonomyProxy(request('DELETE'), 'tags')).body.updated, 2);
  assert.equal(forwarded[0].init.method, 'DELETE');
  assert.equal(forwarded[0].init.headers.Authorization, 'Bearer test-token');
  assert.equal(new URL(forwarded[0].url).searchParams.get('name'), 'API 网关');
  assert.equal(forwarded[0].init.body, undefined);
  response = { ok: true, status: 200, json: async () => ({ error: '默认分类不能删除' }) };
  assert.equal((await taxonomyProxy(request(), 'categories')).status, 400);
  response = new Error('connection refused');
  assert.equal((await taxonomyProxy(request(), 'categories')).status, 503);
  console.log('PASS: taxonomy proxy authentication, admin permissions, origin, exact name, Java error and outage handling');
})().catch((error) => { console.error(error); process.exitCode = 1; });
