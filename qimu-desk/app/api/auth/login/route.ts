import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AUTH_COOKIE, backendBaseUrl, tokenCookieOptions } from "@/core/auth";
import { clientIp, assertOrigin, readJson } from "@/core/api";
import { rateLimit } from "@/core/ratelimit";

export const dynamic = "force-dynamic";

const schema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(128),
});

/**
 * 统一登录：工作台不再自行校验密码，把凭据交给后端 /api/auth/login
 * （后端 users 表 + BCrypt + JWT 是唯一账号事实源），拿到 JWT 后写入本域 Cookie。
 */
export async function POST(req: NextRequest) {
  if (!assertOrigin(req)) {
    return NextResponse.json({ error: "非法请求来源" }, { status: 403 });
  }
  const ip = clientIp(req);
  if (!rateLimit(`login-ip:${ip}`, 30, 10 * 60 * 1000)) {
    return NextResponse.json({ error: "请求过于频繁，请稍后再试" }, { status: 429 });
  }

  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) {
    return NextResponse.json({ error: "用户名或密码格式不正确" }, { status: 400 });
  }
  const { username, password } = parsed.data;
  if (!rateLimit(`login:${ip}:${username}`, 8, 10 * 60 * 1000)) {
    return NextResponse.json({ error: "尝试次数过多，请 10 分钟后再试" }, { status: 429 });
  }

  let data: { ok?: boolean; token?: string; user?: unknown; error?: string };
  try {
    const resp = await fetch(`${backendBaseUrl()}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
      cache: "no-store",
    });
    data = (await resp.json().catch(() => ({}))) as typeof data;
    if (!data.ok || !data.token) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      const status = resp.status >= 500 ? 503 : 401;
      return NextResponse.json({ error: data?.error || "用户名或密码错误" }, { status });
    }
  } catch {
    return NextResponse.json(
      { error: "认证服务暂不可用，请稍后再试" },
      { status: 503 }
    );
  }

  const res = NextResponse.json({ ok: true, user: data.user });
  res.cookies.set(AUTH_COOKIE, data.token as string, tokenCookieOptions());
  return res;
}
