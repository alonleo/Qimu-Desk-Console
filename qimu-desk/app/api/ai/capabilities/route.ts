import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { assertOrigin, jsonError, readJson, requireUser } from "@/core/api";
import { createCapability, listCapabilities } from "@/core/ai/capabilities";
export const dynamic = "force-dynamic";
export async function GET() {
  const user = await requireUser();
  if (!user) return jsonError("未登录", 401);
  try { return NextResponse.json({ capabilities: await listCapabilities(user.id) }); }
  catch { return jsonError("加载 AI 能力失败，请检查数据库及能力加密密钥配置", 500); }
}
export async function POST(req: Request) {
  if (!assertOrigin(req)) return jsonError("来源不合法", 403);
  const user = await requireUser();
  if (!user) return jsonError("未登录", 401);
  if (Number(req.headers.get("content-length") || 0) > 400000) return jsonError("配置文件过大", 413);
  try {
    const id = await createCapability(user.id, await readJson(req));
    return NextResponse.json({ ok: true, id }, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) return jsonError(error.issues[0]?.message || "配置格式错误", 400);
    if ((error as { code?: string }).code === "ER_DUP_ENTRY") return jsonError("同类能力中已存在此名称，请更换名称", 409);
    const msg = error instanceof Error ? error.message : "添加失败";
    return jsonError(/SQL|connect|decrypt|ECONN/i.test(msg) ? "添加失败，请检查数据库及加密密钥配置" : msg, 400);
  }
}
