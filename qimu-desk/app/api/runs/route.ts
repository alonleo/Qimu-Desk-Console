import { NextResponse } from "next/server";
import { requireUser, jsonError } from "@/core/api";
import { listRuns } from "@/core/skills";

export const dynamic = "force-dynamic";

/** 技能运行历史：?skillId= 过滤，?limit= 条数（默认 20） */
export async function GET(req: Request) {
  const user = await requireUser();
  if (!user) return jsonError("未登录", 401);
  const url = new URL(req.url);
  const skillIdRaw = url.searchParams.get("skillId");
  const limitRaw = url.searchParams.get("limit");

  let skillId: number | undefined;
  if (skillIdRaw) {
    skillId = Number(skillIdRaw);
    if (!Number.isInteger(skillId) || skillId <= 0) return jsonError("无效的技能 ID", 400);
  }
  let limit = 20;
  if (limitRaw) {
    limit = Number(limitRaw);
    if (!Number.isInteger(limit) || limit <= 0) return jsonError("无效的 limit", 400);
  }

  try {
    const runs = await listRuns(skillId, limit);
    return NextResponse.json({ runs });
  } catch (e) {
    return jsonError(`获取运行历史失败：${(e as Error).message}`, 500);
  }
}
