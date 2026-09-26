import { NextResponse } from "next/server";
import { requireUser, assertOrigin, jsonError, readJson } from "@/core/api";
import { runSkill } from "@/core/skills";

export const dynamic = "force-dynamic";

/** 执行技能：body = { params: { name: value } } */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return jsonError("未登录", 401);
  if (!assertOrigin(req)) return jsonError("拒绝跨站请求", 403);

  const { id } = await params;
  const skillId = Number(id);
  if (!Number.isInteger(skillId) || skillId <= 0) return jsonError("无效的技能 ID", 400);

  const body = (await readJson(req)) as { params?: Record<string, unknown> } | null;
  if (!body || typeof body !== "object" || Array.isArray(body.params)) {
    return jsonError("请求体必须是 { params: {...} }", 400);
  }

  try {
    const result = await runSkill(skillId, body.params || {}, user.username);
    return NextResponse.json(result);
  } catch (e) {
    return jsonError((e as Error).message || "执行失败", 400);
  }
}
