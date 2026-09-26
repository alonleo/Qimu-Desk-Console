import { NextResponse } from "next/server";
import { requireUser, jsonError } from "@/core/api";
import { getSkillDetail } from "@/core/skills";
import { canReadRow } from "@/core/visibility";

export const dynamic = "force-dynamic";

/** 技能详情（含最近 10 次执行）。member 访问他人 personal 条目 → 404 防探测 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return jsonError("未登录", 401);
  const { id } = await params;
  const skillId = Number(id);
  if (!Number.isInteger(skillId) || skillId <= 0) return jsonError("无效的技能 ID", 400);
  const detail = await getSkillDetail(skillId);
  if (!detail) return jsonError("技能不存在", 404);
  if (!canReadRow(user, detail.skill)) return jsonError("技能不存在", 404);
  return NextResponse.json(detail);
}
