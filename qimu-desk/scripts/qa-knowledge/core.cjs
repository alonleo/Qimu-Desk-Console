// Run: node scripts/qa-knowledge/core.cjs. No database writes or connection required.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
function load(file, deps = {}) {
  const source = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(source, { exports, require: (name) => { if (!(name in deps)) throw Error(`Unexpected import: ${name}`); return deps[name]; } });
  return exports;
}
const visibility = load('core/visibility.ts');
const calls = [];
let results = [];
const db = { rows: async (sql, params) => { calls.push({ sql, params }); return results.shift() || []; }, escapeLike: (s) => s.replace(/[%_\\]/g, '\\$&') };
const knowledge = load('core/knowledge.ts', { './db': db, './visibility': visibility });
(async () => {
  const user = { id: 42, role: 'member' };
  results = [[{ id: 1, title: 'A', tags: 'API,API 网关', content: 'A & B <script>x</script>', source: 'manual' }]];
  const docs = await knowledge.listDocs({ user, tag: 'API', q: 'B' });
  assert.match(calls.at(-1).sql, /FIND_IN_SET\(\?, tags\)/);
  assert.match(calls.at(-1).sql, /d.owner_id = \?/);
  assert.ok(calls.at(-1).params.includes(42));
  assert.equal(docs[0].excerpt, 'A &amp; <em>B</em> &lt;script x&lt;/script');
  results = [[{ id: 1, tags: '', content: 'A & B', source: 'manual' }]];
  assert.equal((await knowledge.listDocs({ user, q: 'title-only-match' }))[0].excerpt, 'A &amp; B');
  results = [[{ name: '未分类', count: 2 }], [{ id: 9, name: '指南' }]];
  const categories = await knowledge.listCategories(user);
  assert.equal(categories.find((c) => c.name === '未分类').count, 2);
  assert.equal(categories.find((c) => c.name === '指南').count, 0);
  assert.match(calls.at(-2).sql, /d.visibility = 'public' OR d.owner_id = \?/);
  results = [[{ tags: 'API,API,工作' }, { tags: 'API' }]];
  const tags = await knowledge.listTags(user);
  assert.equal(tags.find((t) => t.name === 'API').count, 2);
  assert.ok(calls.at(-1).params.includes(42));
  assert.equal(visibility.canEditRow(user, { owner_id: 9, visibility: 'public' }), false);
  assert.equal(visibility.canEditRow(user, { owner_id: 42 }), true);
  console.log('PASS: scoped queries, exact tag matching, safe excerpts, category totals and edit permissions');
})().catch((e) => { console.error(e); process.exitCode = 1; });
