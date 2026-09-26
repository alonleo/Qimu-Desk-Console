import { NextResponse } from "next/server";
import { requireUser, jsonError } from "@/core/api";
import { getWorkflowDetail } from "@/core/workflows";
import { canReadRow } from "@/core/visibility";

export const dynamic = "force-dynamic";

/** 工作流详情 + 最近 10 次运行。member 访问他人 personal 条目 → 404 防探测 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return jsonError("未登录", 401);

  const { id } = await params;
  const workflowId = Number(id);
  if (!Number.isInteger(workflowId) || workflowId <= 0) return jsonError("无效的工作流 ID", 400);

  const detail = await getWorkflowDetail(workflowId);
  if (!detail) return jsonError("工作流不存在", 404);
  if (!canReadRow(user, detail.workflow)) return jsonError("工作流不存在", 404);
  return NextResponse.json(detail);
}
