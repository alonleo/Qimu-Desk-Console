import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const context = { exports: {}, require, process, URL, AbortSignal };
vm.createContext(context);
vm.runInContext(ts.transpileModule(readFileSync(new URL('../../core/ai/mcp.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, context);
const { connectMcp, listMcpTools, isPublicAddress } = context.exports;
for (const ip of ['127.0.0.1', '10.2.3.4', '169.254.169.254', '172.16.0.1', '192.168.0.1', '100.64.0.1', '::1', 'fe80::1', '::ffff:127.0.0.1']) assert.equal(isPublicAddress(ip), false, ip);
assert.equal(isPublicAddress('8.8.8.8'), true);
assert.equal(isPublicAddress('2606:4700:4700::1111'), true);
const requests = [];
const server = createServer(async (req, res) => {
  if (req.method === 'GET') { res.writeHead(405).end(); return; }
  if (req.method === 'DELETE') { res.writeHead(200).end(); return; }
  let text = ''; for await (const chunk of req) text += chunk;
  const body = JSON.parse(text); requests.push({ body, headers: req.headers });
  if (body.method === 'notifications/initialized') { res.writeHead(202).end(); return; }
  const result = body.method === 'initialize' ? { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'test', version: '1' } }
    : body.method === 'tools/list' ? { tools: [{ name: 'echo', description: 'test echo', inputSchema: { type: 'object', properties: { message: { type: 'string' } } } }] }
    : { content: [{ type: 'text', text: body.params.arguments.message }] };
  res.setHeader('mcp-session-id', 'qimu-test-session');
  if (body.method === 'tools/call') {
    res.setHeader('Content-Type', 'text/event-stream');
    res.end(`data: ${JSON.stringify({ jsonrpc: '2.0', id: body.id, result })}\n\n`);
  } else {
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }));
  }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
try {
  const origin = `http://127.0.0.1:${server.address().port}`;
  const config = { name: 'test', url: `${origin}/mcp`, headers: { Authorization: 'Bearer local-test-only' } };
  delete process.env.AI_MCP_ALLOWED_ORIGINS;
  await assert.rejects(connectMcp(config), /内网/);
  process.env.AI_MCP_ALLOWED_ORIGINS = origin;
  const session = await connectMcp(config);
  try {
    const tools = await listMcpTools(session.client); assert.equal(tools[0].name, 'echo');
    const result = await session.client.callTool({ name: 'echo', arguments: { message: 'real MCP result' } });
    assert.equal(result.content[0].text, 'real MCP result');
    const call = requests.find((r) => r.body.method === 'tools/call');
    assert.equal(call.headers['mcp-session-id'], 'qimu-test-session');
    assert.equal(call.headers['mcp-protocol-version'], '2025-06-18');
    assert.equal(call.headers.authorization, 'Bearer local-test-only');
  } finally { await session.close(); }
} finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
console.log('PASS: SSRF policy, real MCP initialization, JSON discovery, SSE tool result, session and auth headers');
