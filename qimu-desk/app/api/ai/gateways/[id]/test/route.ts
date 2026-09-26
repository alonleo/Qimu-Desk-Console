import { NextResponse } from "next/server";
import { assertOrigin, jsonError, requireAdmin } from "@/core/api";
import { chatLlm, getAiConfigById, maskApiKey } from "@/core/llm";

/**
 * POST /api/ai/gateways/[id]/test —— 用指定网关跑一次最小请求验证连通（管理员）
 * 不传 / 找不到 id 时，回退到默认网关。
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!assertOrigin(req)) return jsonError("跨域请求被拒绝", 403);
  const admin = await requireAdmin();
  if (!admin) return jsonError("仅管理员可测试 AI 网关", 403);

  const { id: idStr } = await ctx.params;
  const id = Number(idStr);
  const cfg = Number.isInteger(id) && id > 0 ? await getAiConfigById(id) : null;
  if (!cfg) return jsonError("网关不存在", 404);

  // 不启用也允许测试（用临时启用一次）
  const r = await chatLlm({ messages: [{ role: "user", content: "ping" }], maxTokens: 8, cfg });
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error });
  return NextResponse.json({ ok: true, reply: r.content });
}
