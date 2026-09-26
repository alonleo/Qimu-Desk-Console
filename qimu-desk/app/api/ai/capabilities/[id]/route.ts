import { NextResponse } from "next/server";
import { assertOrigin, jsonError, readJson, requireUser } from "@/core/api";
import { deleteCapability, updateCapability } from "@/core/ai/capabilities";
type Context = { params: Promise<{ id: string }> };
async function mutate(req: Request, context: Context, remove: boolean) {
  if (!assertOrigin(req)) return jsonError("来源不合法", 403);
  const user = await requireUser();
  if (!user) return jsonError("未登录", 401);
  const id = Number((await context.params).id);
  if (!Number.isSafeInteger(id) || id < 1) return jsonError("无效的能力 ID", 400);
  try {
    let ok: boolean;
    if (remove) ok = await deleteCapability(user.id, id);
    else {
      const body = await readJson(req) as { enabled?: unknown } | null;
      if (typeof body?.enabled !== "boolean") return jsonError("enabled 必须为布尔值", 400);
      ok = await updateCapability(user.id, id, body.enabled);
    }
    return ok ? NextResponse.json({ ok: true }) : jsonError("能力不存在", 404);
  } catch { return jsonError("操作失败，请稍后重试", 500); }
}
export const PATCH = (req: Request, context: Context) => mutate(req, context, false);
export const DELETE = (req: Request, context: Context) => mutate(req, context, true);
