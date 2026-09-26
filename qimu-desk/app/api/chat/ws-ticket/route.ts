import { NextResponse } from "next/server";
import { requireUser, jsonError } from "@/core/api";
import { requestToken } from "@/core/auth";

/**
 * WS 凭据回吐（chat-module）：wb_token 为 HttpOnly，浏览器 JS 读不到；
 * 服务端校验当前用户已登录后，把该 JWT 以 {ok:true,data:{token}} 返回，
 * 供 WS 握手 ?token= 与后端写请求 Authorization: Bearer 使用。
 * 该 JWT 本就是浏览器的登录凭据，回吐给已鉴权会话不放大风险（架构文档 §1.1 定案）。
 */

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await requireUser();
  if (!user) return jsonError("未登录", 401);
  const token = await requestToken();
  if (!token) return jsonError("会话凭据缺失", 401);
  return NextResponse.json({ ok: true, data: { token } });
}
