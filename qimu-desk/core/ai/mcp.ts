import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Agent, fetch as httpFetch } from "undici";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { McpServerConfig } from "./capability-schema";

export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0)) || (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19)));
  }
  // Global unicast only; rejects loopback, link-local, ULA and IPv4-mapped forms.
  return isIP(address) === 6 && /^[23]/i.test(address) && !/^2001:db8:/i.test(address);
}
export async function connectMcp(config: McpServerConfig, signal?: AbortSignal) {
  const url = new URL(config.url);
  const explicitlyAllowed = (process.env.AI_MCP_ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).includes(url.origin);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = await lookup(hostname, { all: true });
  if (!addresses.length || (!explicitlyAllowed && addresses.some((a) => !isPublicAddress(a.address)))) {
    throw new Error("MCP 地址指向内网；如需连接，请由管理员将服务 origin 加入 AI_MCP_ALLOWED_ORIGINS");
  }
  // Pin the validated DNS answer to prevent a second resolution (DNS rebinding).
  const agent = new Agent({ connect: { lookup: (_host, options, callback) => {
    if (options.all) callback(null, addresses);
    else callback(null, addresses[0].address, addresses[0].family);
  } } });
  const client = new Client({ name: "qimu-desk", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: { headers: config.headers },
    fetch: async (input, init) => {
      const target = new URL(String(input));
      if (target.origin !== url.origin || target.pathname !== url.pathname) throw new Error("MCP 请求地址发生变化");
      signal?.throwIfAborted();
      const response = await httpFetch(target, {
        ...init as Parameters<typeof httpFetch>[1], dispatcher: agent, redirect: "error",
        signal: AbortSignal.any([AbortSignal.timeout(30000), ...(signal ? [signal] : []), ...(init?.signal ? [init.signal] : [])]),
      });
      return response as unknown as Response;
    },
  });
  let closing: Promise<void> | undefined;
  const close = () => closing ??= (async () => {
    await transport.terminateSession().catch(() => {});
    await client.close().catch(() => {});
    await agent.close().catch(() => {});
  })();
  const abort = () => { void close(); };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    signal?.throwIfAborted();
    await client.connect(transport);
    signal?.throwIfAborted();
    return { client, close: async () => { signal?.removeEventListener("abort", abort); await close(); } };
  } catch (error) {
    signal?.removeEventListener("abort", abort); await close(); throw error;
  }
}
export async function listMcpTools(client: Client, signal?: AbortSignal) {
  const tools: Awaited<ReturnType<Client["listTools"]>>["tools"] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 10; page++) {
    const result = await client.listTools(cursor ? { cursor } : {}, { signal, timeout: 30000 });
    tools.push(...result.tools);
    if (tools.length > 64) throw new Error("MCP 服务工具超过 64 个，请在服务端精简工具列表");
    cursor = result.nextCursor;
    if (!cursor) return tools;
  }
  throw new Error("MCP 工具分页数量过多");
}
