/** Opt-in real model + database integration. Never prints credentials or business content.
 * Required: E2E_BASE_URL, E2E_TOKEN (existing wb_token), DB_HOST/DB_USER/DB_PASSWORD/DB_NAME.
 * Instead of E2E_TOKEN: E2E_CREATE_TEST_USER=1 with configured JWT_SECRET provisions a temporary fixture.
 * Optional: E2E_NOTIFICATIONS_ONLY=1 verifies notification CRUD over SSE only.
 * Optional: E2E_GATEWAY_ID; ADMIN_BACKEND_URL is required for emergency notice cleanup.
 * Run only against an environment running the current workspace-tools implementation.
 */
const assert = require('node:assert/strict');
const mysql = require('mysql2/promise');
require('@next/env').loadEnvConfig(process.cwd());
const base = process.env.E2E_BASE_URL;
let token = process.env.E2E_TOKEN;
let testUserId;
const backend = process.env.ADMIN_BACKEND_URL;
const marker = `AI-E2E-${Date.now()}`;
const specs = [
  { resource: 'projects', table: 'projects', key: 'name', label: '项目', field: 'description', initial: '联调初始描述', updated: '联调已更新描述' },
  { resource: 'tasks', table: 'tasks', key: 'title', label: '任务', field: 'notes', initial: '联调初始备注', updated: '联调已更新备注' },
  { resource: 'knowledge', table: 'docs', key: 'title', label: '知识库文档', field: 'content', initial: '联调初始正文', updated: '联调已更新正文' },
  { resource: 'notices', table: 'notice', key: 'title', type: 'announcement', label: '公告草稿', field: 'content', initial: '联调初始正文', updated: '联调已更新正文' },
];
specs.push({ resource: 'notices', table: 'notice', key: 'title', type: 'notification', label: '通知草稿', field: 'content', initial: '联调初始正文', updated: '联调已更新正文', stream: true });
const selectedSpecs = process.env.E2E_NOTIFICATIONS_ONLY === '1' ? specs.filter(s => s.type === 'notification') : specs;
let db;
const report = [];
async function api(path, options = {}) {
  const response = await fetch(`${base}${path}`, { ...options, signal: AbortSignal.timeout(240000),
    headers: { Cookie: `wb_token=${token}`, 'Content-Type': 'application/json', ...options.headers } });
  let data;
  if (response.headers.get('content-type')?.includes('text/event-stream')) {
    const events = (await response.text()).split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)));
    const error = events.find(e => e.type === 'error');
    assert.ok(!error, `SSE error: ${error?.error || ''}`);
    data = events.find(e => e.type === 'done');
    assert.ok(data, 'SSE must finish with done');
    assert.ok(events.some(e => e.type === 'tool' && e.run?.status === 'success'), 'SSE must report tool success');
  } else data = await response.json();
  assert.ok(response.ok && data.ok !== false && !data.error, `API failed (HTTP ${response.status}): ${String(data.error || "unknown").replace(/https?:\/\/\S+/g, "[URL]").slice(0, 400)}`);
  return data;
}
async function chat(prompt, resource, stream = false) {
  const result = await api('/api/ai/chat', { method: 'POST', body: JSON.stringify({
    messages: [{ role: 'user', content: prompt }], allowToolCalls: true, useKnowledge: false, stream,
    ...(process.env.E2E_GATEWAY_ID ? { gatewayId: Number(process.env.E2E_GATEWAY_ID) } : {}),
  }) });
  const runs = result.toolRuns || [];
  assert.ok(runs.some(r => r.status === 'success' && r.name.includes({ tasks: '任务', projects: '项目', knowledge: '知识库', notices: '通知公告' }[resource])), 'No successful real business tool call');
  assert.ok(!runs.some(r => r.status === 'error'), 'Model returned a failed tool call');
  return runs.length;
}
async function find(spec) {
  const [records] = await db.execute(`SELECT * FROM ${spec.table} WHERE ${spec.key} = ?`, [`${marker}-${spec.type || spec.resource}`]);
  return records;
}
async function cleanup() {
  if (!db) return;
  for (const spec of [...selectedSpecs].reverse()) {
    for (const item of await find(spec)) {
      if (spec.resource === 'notices') {
        assert.ok(backend, 'ADMIN_BACKEND_URL required to clean up notice draft');
        const response = await fetch(`${backend.replace(/\/$/, '')}/api/notices/${item.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
        const data = await response.json();
        assert.ok(response.ok && data.ok === true, 'Notice cleanup failed');
      } else await api(`/api/${spec.resource}/${item.id}`, { method: 'DELETE' });
    }
    assert.equal((await find(spec)).length, 0, `Cleanup incomplete: ${spec.resource}`);
  }
}
(async () => {
  assert.ok(base && backend && (token || process.env.E2E_CREATE_TEST_USER === '1'), 'Set target URLs and E2E_TOKEN (or opt into a temporary test user)');
  db = await mysql.createConnection({ host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '', database: process.env.DB_NAME || 'qimu_platform', connectTimeout: 5000 });
  if (process.env.E2E_CREATE_TEST_USER === '1') {
    const { createHmac, randomBytes } = require('node:crypto');
    assert.ok(process.env.JWT_SECRET?.length >= 32, 'Configured JWT_SECRET required for temporary fixture');
    const username = `${marker}-admin`;
    const [created] = await db.execute('INSERT INTO users (username,password_hash,role,display_name) VALUES (?,?,?,?)',
      [username, `!test-only-no-password-login-${randomBytes(24).toString('hex')}`, 'admin', 'AI 临时联调账号']);
    testUserId = created.insertId;
    const encode = x => Buffer.from(JSON.stringify(x)).toString('base64url');
    const unsigned = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: String(testUserId), username, role: 'admin', exp: Math.floor(Date.now()/1000)+3600 })}`;
    token = `${unsigned}.${createHmac('sha256', process.env.JWT_SECRET).update(unsigned).digest('base64url')}`;
  }
  // Authenticated admin is needed to cover notice writes; no users or model config are modified.
  const me = await api('/api/auth/me');
  assert.equal(me.user?.role, 'admin', 'An existing admin test session is required for notice CRUD');
  console.log(`Run marker: ${marker}`);
  for (const spec of selectedSpecs) {
    const name = `${marker}-${spec.type || spec.resource}`;
    await chat(`这是已授权的端到端联调。请实际创建一个${spec.label}，${spec.key === 'name' ? '名称' : '标题'}必须精确为「${name}」，${spec.field}必须精确为「${spec.initial}」。${spec.resource === 'notices' ? `type=${spec.type}，status=draft，禁止发布。` : 'visibility=personal。'}不要只生成草稿卡片。`, spec.resource, spec.stream);
    let records = await find(spec);
    assert.equal(records.length, 1, `${spec.type || spec.resource}: creation must persist exactly once`);
    const id = records[0].id;
    assert.equal(records[0][spec.field], spec.initial);
    if (spec.resource === 'notices') { assert.equal(records[0].status, 'draft'); assert.equal(records[0].type, spec.type); }
    report.push(`${spec.type || spec.resource}: create PASS (id=${id})`); console.log(report.at(-1));
    await chat(`请先查询确认${spec.label} ID=${id}，标题或名称为「${name}」，然后仅把 ${spec.field} 改为「${spec.updated}」。保留其他字段${spec.resource === 'notices' ? '及 draft 状态，禁止发布' : ''}。`, spec.resource, spec.stream);
    records = await find(spec);
    assert.equal(records.length, 1);
    assert.equal(records[0][spec.field], spec.updated);
    if (spec.resource === 'notices') { assert.equal(records[0].status, 'draft'); assert.equal(records[0].type, spec.type); }
    report.push(`${spec.type || spec.resource}: read/update PASS`); console.log(report.at(-1));
    await chat(`请查询核对并实际删除刚才的联调${spec.label} ID=${id}，名称或标题精确为「${name}」。删除已授权，仅删除此条。`, spec.resource, spec.stream);
    assert.equal((await find(spec)).length, 0, `${spec.type || spec.resource}: deletion must persist`);
    report.push(`${spec.type || spec.resource}: delete PASS`); console.log(report.at(-1));
  }
})().catch(error => {
  // Do not echo upstream bodies, URLs, SQL values, tokens or model responses.
  console.error('FAIL:', error instanceof assert.AssertionError ? error.message : error.code || error.name);
  process.exitCode = 1;
}).finally(async () => {
  try { await cleanup(); if (testUserId) { await db.execute('DELETE FROM users WHERE id = ? AND username = ?', [testUserId, `${marker}-admin`]); console.log('Temporary test account removed'); } if (db) console.log('Cleanup verified: no marked test records remain'); }
  catch { console.error(`CLEANUP REQUIRED for marker ${marker}`); process.exitCode = 1; }
  finally { if (db) await db.end(); }
});
