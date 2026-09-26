import { z } from "zod";
import YAML from "yaml";

const name = z.string().trim().min(1, "名称不能为空").max(80);
const description = z.string().trim().max(1000).default("");
const instructions = z.string().trim().min(1, "Skill 指令不能为空").max(50000);
export const skillSchema = z.object({ name, description, instructions }).strict();
export const mcpServerSchema = z.object({
  name,
  url: z.string().url("请输入完整 MCP HTTP 地址").max(2000).refine((value) => {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.hash;
  }, "MCP 仅支持不含账号、密码和片段的 HTTP / HTTPS 地址"),
  headers: z.record(z.string().max(4000)).default({}).refine((headers) =>
    Object.keys(headers).length <= 10 && Object.entries(headers).every(([key, value]) =>
      /^[A-Za-z0-9-]+$/.test(key) && !/[\r\n]/.test(value) &&
      !/^(host|cookie|connection|content-length|transfer-encoding|mcp-session-id|mcp-protocol-version)$/i.test(key)),
  "请求头无效，请仅填写认证等必要头部"),
}).strict();
export const pluginSchema = z.object({
  name,
  description,
  version: z.string().max(40).default("1.0.0"),
  skills: z.array(skillSchema).max(10).default([]),
  mcpServers: z.array(mcpServerSchema).max(5).default([]),
}).strict().refine((p) => p.skills.length + p.mcpServers.length > 0, "插件至少包含一个 Skill 或 MCP 服务");
export const capabilityInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("skill"), source: z.string().min(1).max(60000) }).strict(),
  z.object({ kind: z.literal("mcp"), source: z.string().min(1).max(60000) }).strict(),
  z.object({ kind: z.literal("plugin"), source: z.string().min(1).max(300000) }).strict(),
]);
export type McpServerConfig = z.infer<typeof mcpServerSchema>;
export type CapabilityConfig = { skills: z.infer<typeof skillSchema>[]; mcpServers: McpServerConfig[] };
export type CapabilityKind = "skill" | "mcp" | "plugin";
export type CapabilitySummary = {
  id: number; kind: CapabilityKind; name: string; description: string; enabled: boolean;
  skillCount: number; serverCount: number;
};
export type ToolRun = { id: string; name: string; status: "running" | "success" | "error"; output?: string };

export function parseCapability(input: unknown): { kind: CapabilityKind; name: string; description: string; config: CapabilityConfig } {
  const data = capabilityInputSchema.parse(input);
  if (data.kind === "skill") {
    const source = data.source.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
    const match = source.match(/^---\n([\s\S]*?)\n---(?:\n|$)([\s\S]*)$/);
    if (!match) throw new Error("SKILL.md 需要 YAML 头部（name、description）和正文指令");
    const meta: unknown = YAML.parse(match[1], { maxAliasCount: 0 });
    if (!meta || typeof meta !== "object" || Array.isArray(meta)) throw new Error("SKILL.md 头部格式错误");
    const m = meta as Record<string, unknown>;
    const skill = skillSchema.parse({ name: m.name, description: m.description, instructions: match[2] });
    return { kind: data.kind, name: skill.name, description: skill.description, config: { skills: [skill], mcpServers: [] } };
  }
  let source: unknown;
  try { source = JSON.parse(data.source); } catch { throw new Error("请输入有效的 JSON 配置"); }
  if (data.kind === "mcp") {
    const server = mcpServerSchema.parse(source);
    return { kind: data.kind, name: server.name, description: "远程 MCP 工具服务", config: { skills: [], mcpServers: [server] } };
  }
  const plugin = pluginSchema.parse(source);
  return { kind: data.kind, name: plugin.name, description: plugin.description, config: { skills: plugin.skills, mcpServers: plugin.mcpServers } };
}
