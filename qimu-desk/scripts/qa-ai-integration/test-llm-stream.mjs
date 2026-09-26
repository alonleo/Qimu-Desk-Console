import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source = readFileSync(new URL('../../core/llm.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const cfg = { enabled: true, base_url: 'https://example.invalid/v1', api_key: 'test', model: 'test' };
async function run(response, timeout = false) {
  let calls = 0; const deltas = [];
  const context = {
    exports: {}, require: () => ({}), AbortController, TextDecoder,
    setTimeout: timeout ? (fn) => { queueMicrotask(fn); return 1; } : setTimeout,
    clearTimeout: timeout ? () => {} : clearTimeout,
    fetch: async (_, opts) => { calls++; if (timeout) { await Promise.resolve(); opts.signal.throwIfAborted(); } return response; },
  };
  vm.createContext(context); vm.runInContext(js, context);
  const result = await context.exports.chatLlmStream({ cfg, messages: [{ role: 'user', content: 'hello' }], onDelta: (s) => deltas.push(s) });
  return { result, calls, deltas };
}
{
  const { result, calls, deltas } = await run(Response.json({ choices: [{ message: { content: 'JSON answer' } }] }));
  assert.equal(result.content, 'JSON answer'); assert.equal(calls, 1); assert.deepEqual(deltas, ['JSON answer']);
}
{
  const { result } = await run(new Response('data: {"choices":[{"delta":{"content":"尾部"}}]}'));
  assert.equal(result.content, '尾部');
}
{
  const { result } = await run(null, true);
  assert.equal(result.ok, false); assert.equal(result.aborted, false, 'timeouts must reach the user as errors');
}
console.log('PASS: JSON compatibility without replay, SSE EOF, timeout classification');
