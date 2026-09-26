import { NextResponse } from "next/server";
import { assertOrigin, jsonError, requireUser } from "@/core/api";
import { getCapability } from "@/core/ai/capabilities";
import { connectMcp, listMcpTools } from "@/core/ai/mcp";
export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  if (!assertOrigin(req)) return jsonError("来源不合法", 403);
  const user = await requireUser();
  if (!user) return jsonError("未登录", 401);
  const id = Number((await context.params).id);
  if (!Number.isSafeInteger(id) || id < 1) return jsonError("无效的能力 ID", 400);
  try {
    const capability = await getCapability(user.id, id);
    if (!capability) return jsonError("能力不存在", 404);
    const tools: { name: string; description: string }[] = [];
    const signal = AbortSignal.any([req.signal, AbortSignal.timeout(45000)]);
    for (const server of capability.config.mcpServers) {
      const session = await connectMcp(server, signal);
      try {
        const discovered = await listMcpTools(session.client, signal);
        tools.push(...discovered.map((tool) => ({ name: `${server.name} / ${tool.name}`, description: tool.description || "" })));
      } finally { await session.close(); }
    }
    return NextResponse.json({ ok: true, tools, skills: capability.config.skills.map((s) => s.name) });
  } catch { return jsonError("连接失败，请检查 MCP 地址、认证信息、服务状态和内网访问配置", 400); }
}
