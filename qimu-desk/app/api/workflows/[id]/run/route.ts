import { NextResponse } from "next/server";
import { requireUser, assertOrigin, jsonError, readJson } from "@/core/api";
import { runWorkflow, startWorkflowRun } from "@/core/workflows";

export const dynamic = "force-dynamic";

/**
 * 执行工作流：body = { params: {...}, async?: boolean }
 * - async=true：创建运行记录后立即返回 { runId, status: "running" }，后台执行并落库（前端轮询取结果）
 * - 默认同步：等待全部步骤执行完返回完整结果（Hub 面板兼容）
 * http 步骤的相对 URL 用请求来源补全
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return jsonError("未登录", 401);
  if (!assertOrigin(req)) return jsonError("拒绝跨站请求", 403);

  const { id } = await params;
  const workflowId = Number(id);
  if (!Number.isInteger(workflowId) || workflowId <= 0) return jsonError("无效的工作流 ID", 400);

  const body = (await readJson(req)) as
    | { params?: Record<string, unknown>; async?: boolean }
    | null;
  if (!body || typeof body !== "object" || Array.isArray(body.params)) {
    return jsonError("请求体必须是 { params: {...} }", 400);
  }

  // 反代场景优先取转发头，本地直连时退回请求本身
  const proto = req.headers.get("x-forwarded-proto") || "http";
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  const baseUrl = host ? `${proto}://${host}` : undefined;

  try {
    if (body.async === true) {
      const { runId } = await startWorkflowRun(workflowId, body.params || {}, user.username, baseUrl);
      return NextResponse.json({ runId, status: "running", async: true }, { status: 202 });
    }
    const result = await runWorkflow(workflowId, body.params || {}, user.username, baseUrl);
    return NextResponse.json(result);
  } catch (e) {
    return jsonError((e as Error).message || "执行失败", 400);
  }
}
