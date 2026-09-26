import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { AUTH_COOKIE } from "@/core/auth";

export const dynamic = "force-dynamic";

/** JWT 无状态：登出仅清除本域 Cookie（后端 logout 为幂等 no-op，无需转发） */
export async function POST() {
  const store = await cookies();
  store.delete(AUTH_COOKIE);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  return res;
}
