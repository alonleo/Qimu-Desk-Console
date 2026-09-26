import { NextResponse } from "next/server";
import { assertOrigin, jsonError, requireAdmin } from "@/core/api";
import { testConnection } from "@/core/llm";

/** 测试 AI 网关连通性（管理员） */
export async function POST(req: Request) {
  if (!assertOrigin(req)) return jsonError("跨域请求被拒绝", 403);
  const admin = await requireAdmin();
  if (!admin) return jsonError("仅管理员可测试 AI 网关", 403);

  const r = await testConnection();
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error });
  return NextResponse.json({ ok: true, reply: r.content });
}
