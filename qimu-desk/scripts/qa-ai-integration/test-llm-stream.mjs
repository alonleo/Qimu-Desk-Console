import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source = readFileSync(new URL('../../core/llm.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const cfg = { enabled: true, base_url: 'https://example.invalid/v1', api_key: 'test', model: 'test' };
async function run(response, timeout = false, model = "test", streaming = true, cfgOverrides = {}) {
  let calls = 0; const deltas = []; let request;
  const context = {
    exports: {}, require: () => ({}), AbortController, TextDecoder,
    setTimeout: timeout ? (fn) => { queueMicrotask(fn); return 1; } : setTimeout,
    clearTimeout: timeout ? () => {} : clearTimeout,
    fetch: async (_, opts) => { calls++; request = JSON.parse(opts.body); if (timeout) { await Promise.resolve(); opts.signal.throwIfAborted(); } return response; },
  };
  vm.createContext(context); vm.runInContext(js, context);
  const result = await context.exports[streaming ? "chatLlmStream" : "chatLlm"]({ cfg: { ...cfg, model, ...cfgOverrides }, maxTokens: 4000, messages: [{ role: 'user', content: 'hello' }], onDelta: (s) => deltas.push(s) });
  return { result, calls, deltas, request, api: context.exports };
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

for (const content of ['<think>未完成的推理', '部分正文']) {
  const { result, calls } = await run(new Response('data: ' + JSON.stringify({ choices: [{ delta: { content }, finish_reason: 'length' }] }) + '\n\ndata: [DONE]\n\n'));
  assert.equal(result.ok, false, 'length-limited generation must report truncation');
  assert.match(result.error, /长度/);
  assert.equal(calls, 1);
}
{
  const { result } = await run(Response.json({ choices: [{ message: { content: '' }, finish_reason: 'length' }] }));
  assert.match(result.error, /长度/);
}

for (const streaming of [true, false]) {
  for (const model of ['MiniMax-M2.7-highspeed', 'MiniMax-M3']) {
    const { result, request, calls } = await run(Response.json({ choices: [{ message: { content: '正式回答', reasoning_details: [{ text: '不应展示的思考' }] }, finish_reason: 'stop' }] }), false, model, streaming);
    assert.equal(result.content, '正式回答'); assert.equal(calls, 1);
    assert.equal(request.reasoning_split, true); assert.equal(request.max_tokens, 16384);
  }
  const {request} = await run(Response.json({choices:[{message:{content:'回答'}}]}),false,'other-model',streaming);
  assert.equal(request.max_tokens,4000);assert.equal(request.reasoning_split,undefined);
}
{
  const {result,deltas} = await run(new Response('data: {"choices":[{"delta":{"reasoning_content":"思考"}}]}\n\ndata: {"choices":[{"delta":{"content":"正式回答"},"finish_reason":"stop"}]}\n\n'),false,'MiniMax-M3');
  assert.equal(result.content,'正式回答');assert.deepEqual(deltas,['正式回答']);
}
console.log('PASS: MiniMax streaming/JSON reasoning separation and output budget, generic gateway compatibility');

for (const streaming of [true,false]) {
  const {request,api}=await run(Response.json({choices:[{message:{content:'answer'}}]}),false,'MiniMax-M3',streaming,{max_output_tokens:32000,timeout_seconds:150});
  assert.equal(request.max_tokens,32000);assert.equal(api.generationTimeout({timeout_seconds:150},90_000),150_000);
  const limited=await run(Response.json({}),false,'MiniMax-M3',streaming,{max_input_tokens:1});
  assert.equal(limited.result.ok,false);assert.equal(limited.calls,0);assert.match(limited.result.error,/输入上下文/);
  for(const value of [-1,1.5,'100',null,262145]) assert.throws(()=>api.parseGatewayLimits({max_output_tokens:value}));
  assert.equal(api.parseGatewayLimits({max_output_tokens:0}).max_output_tokens,0);
}
console.log('PASS: explicit output/timeout settings, input guard before network, invalid limits rejected');
