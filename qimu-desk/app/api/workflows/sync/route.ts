import { NextResponse } from "next/server";
import { requireUser, assertOrigin, jsonError } from "@/core/api";
import { syncWorkflows } from "@/core/workflows";

export const dynamic = "force-dynamic";

/** 重新播种 workflows/ 目录（缺失才插入，不删除/覆盖后台维护的行） */
export async function POST(req: Request) {
  const user = await requireUser();
  if (!user) return jsonError("未登录", 401);
  if (!assertOrigin(req)) return jsonError("拒绝跨站请求", 403);
  try {
    const result = await syncWorkflows();
    return NextResponse.json(result);
  } catch (e) {
    return jsonError(`同步失败：${(e as Error).message}`, 500);
  }
}
