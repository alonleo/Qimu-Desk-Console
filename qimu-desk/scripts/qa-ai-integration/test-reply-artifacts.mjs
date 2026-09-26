import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../../core/ai/artifacts.ts', import.meta.url), 'utf8');
const context = { exports: {}, require: (name) => name === 'zod' ? require(name) : {} };
vm.createContext(context);
vm.runInContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
const extract = context.exports.extractArtifacts;
const draft = JSON.stringify([{ kind: 'knowledge', payload: { title: '示例', content: '正文' } }]);
for (const block of [`<artifacts>${draft}</artifacts>`, '```json\n' + draft + '\n```']) {
  const result = extract('<think>分析</think>\n' + block + '\n这是完整回答');
  assert.ok(result.reply.includes('这是完整回答'), 'answer after artifact must survive extraction');
  assert.equal(result.drafts.length, 1);
}
console.log('PASS: answers after tagged and fenced artifacts are preserved');
{
  const result = extract('<think>格式示例：<artifacts>'+draft+'</artifacts></think>\n这是正式回答');
  assert.equal(result.reply,'这是正式回答');
  assert.equal(result.drafts.length,0,'draft examples in thinking must never become savable drafts');
}
