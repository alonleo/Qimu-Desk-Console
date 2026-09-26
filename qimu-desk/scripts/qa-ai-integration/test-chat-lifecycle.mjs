import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';

// Exercise the actual component request callback with controlled network and animation scheduling.
const source = readFileSync(process.env.AI_VIEW_SOURCE || new URL('../../components/ai/AIView.tsx', import.meta.url), 'utf8');
const callback = source.slice(source.indexOf('    async (convId:'), source.indexOf('    // eslint-disable-next-line react-hooks/exhaustive-deps\n    [picked, useKnowledge')) .trim().replace(/,$/, '');
function harness(fetch) {
  const frames = new Map(); let id = 0;
  const state = { commits: [], streaming: null, warnings: [] };
  const context = {
    fetch, AbortController, TextDecoder, performance,
    picked: { id: 1, enabled: true }, gateways: [], useKnowledge: false, SEND_TRIM: 40,
    jsonFallbackRef: { current: false }, abortRef: { current: null }, finishStreamRef: { current: null },
    setLiveToolRuns: () => {},
    setStreaming: (value) => { state.streaming = value; },
    commitItems: (convId, items) => state.commits.push({ convId, items }),
    stripThink: (s) => s, stripArtifactRegion: (s) => s,
    appMessage: { warning: (s) => state.warnings.push(s) },
    requestAnimationFrame: (fn) => { frames.set(++id, fn); return id; },
    cancelAnimationFrame: (key) => frames.delete(key),
  };
  context.abortCurrentStream = () => { context.abortRef.current?.abort(); context.finishStreamRef.current?.(); };
  vm.createContext(context);
  vm.runInContext(ts.transpileModule(`globalThis.run = ${callback}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { context, state, flush() { for (let i = 0; frames.size && i < 1000; i++) { const batch = [...frames.values()]; frames.clear(); batch.forEach((f) => f()); } assert.equal(frames.size, 0); } };
}
const user = [{ role: 'user', content: 'hello' }];
const sse = (text) => new Response(text, { headers: { 'Content-Type': 'text/event-stream' } });
let count = 0;
{
  const h = harness(async () => { count++; return new Response('{"error":"未登录"}', { status: 401 }); });
  await h.context.run('a', user);
  assert.equal(count, 1, 'HTTP errors must not repeat potentially mutating requests');
  assert.equal(h.state.commits[0].items.at(-1).error, true);
}
{
  const h = harness(async () => sse('data: {"type":"done","reply":"完整回答"}'));
  await h.context.run('a', user); h.flush();
  assert.equal(h.state.commits[0].items.at(-1).content, '完整回答', 'EOF without newline retains final event');
}
{
  const h = harness(async () => sse('data: {"type":"delta","text":"partial"}\n\n'));
  await h.context.run('a', user); h.flush();
  assert.equal(h.state.commits[0].items.at(-1).content, 'partial');
  assert.equal(h.state.warnings.length, 1, 'truncated answers report interruption');
}
{
  const pending = [];
  const h = harness(() => new Promise((resolve, reject) => pending.push({ resolve, reject })));
  const old = h.context.run('old', user);
  h.context.abortCurrentStream();
  const next = h.context.run('new', user);
  const controller = h.context.abortRef.current;
  pending[0].reject(new Error('late abort')); await old;
  assert.equal(h.context.abortRef.current, controller, 'old completion cannot clear new controller');
  assert.equal(h.state.streaming.convId, 'new');
  pending[1].resolve(sse('data: {"type":"done","reply":"new answer"}\n\n')); await next; h.flush();
  assert.equal(h.state.commits.length, 1);
  assert.equal(h.state.commits[0].convId, 'new');
}
{
  let body;
  const h = harness(async (_, opts) => { body = JSON.parse(opts.body); return sse('data: {"type":"done","reply":"ok"}\n\n'); });
  await h.context.run('a', [...user, { role: 'assistant', content: 'error', error: true }, ...user]); h.flush();
  assert.equal(body.messages.length, 2, 'error messages are excluded from model context');
  assert.ok(!('autoSave' in body), 'chat requests no longer include automatic saving');
}
{
  const h = harness(async () => sse('data: {"type":"done","reply":"","drafts":[{"kind":"knowledge","payload":{"title":"草稿"}}]}\n\n'));
  await h.context.run('a', user); h.flush();
  assert.equal(h.state.commits[0].items.at(-1).drafts.length, 1, 'draft-only responses remain actionable');
}
{
  const h = harness(async () => sse('data: {"type":"tool","run":{"id":"t1","name":"echo","status":"success","output":"saved"}}\n\ndata: {"type":"error","error":"model failed"}\n\n'));
  await h.context.run('a', user); h.flush();
  assert.equal(h.state.commits[0].items.at(-1).toolRuns[0].output, 'saved', 'completed tool results survive final model failure');
}
console.log('PASS: HTTP errors, EOF, truncated stream, stop, stale response isolation, context filtering');
