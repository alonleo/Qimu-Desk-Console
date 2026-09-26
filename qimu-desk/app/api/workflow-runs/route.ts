import { NextResponse } from "next/server";
import { requireUser, jsonError } from "@/core/api";
import { listWorkflowRuns } from "@/core/workflows";

export const dynamic = "force-dynamic";

/** 工作流运行历史：?workflowId= 过滤，?limit= 条数（默认 20，上限 100） */
export async function GET(req: Request) {
  const user = await requireUser();
  if (!user) return jsonError("未登录", 401);

  const url = new URL(req.url);
  const wfParam = url.searchParams.get("workflowId");
  const limitParam = url.searchParams.get("limit");

  const workflowId = wfParam ? Number(wfParam) : undefined;
  if (workflowId !== undefined && (!Number.isInteger(workflowId) || workflowId <= 0)) {
    return jsonError("无效的 workflowId", 400);
  }
  const limit = limitParam ? Number(limitParam) : 20;
  if (!Number.isInteger(limit) || limit <= 0) return jsonError("无效的 limit", 400);

  try {
    const runs = await listWorkflowRuns(workflowId, limit);
    return NextResponse.json({ runs });
  } catch (e) {
    return jsonError(`获取运行历史失败：${(e as Error).message}`, 500);
  }
}
