import { NextResponse } from "next/server";
import { requireUser, assertOrigin, jsonError } from "@/core/api";
import { syncSkills } from "@/core/skills";

export const dynamic = "force-dynamic";

/** 强制重新播种 skills/ 目录（缺失才插入，不删除/覆盖后台维护的行） */
export async function POST(req: Request) {
  const user = await requireUser();
  if (!user) return jsonError("未登录", 401);
  if (!assertOrigin(req)) return jsonError("拒绝跨站请求", 403);
  try {
    const result = await syncSkills();
    return NextResponse.json(result);
  } catch (e) {
    return jsonError(`同步失败：${(e as Error).message}`, 500);
  }
}
