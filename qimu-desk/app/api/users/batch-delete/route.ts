import { NextRequest, NextResponse } from "next/server";
import { currentUser, backendBaseUrl, requestToken } from "@/core/auth";
import { assertOrigin, readJson } from "@/core/api";

export const dynamic = "force-dynamic";

/** 代理到后端：批量删除用户 */
export async function POST(req: NextRequest) {
  if (!assertOrigin(req)) {
    return NextResponse.json({ error: "非法请求来源" }, { status: 403 });
  }

  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  if (user.role !== "admin") {
    return NextResponse.json({ error: "无权限" }, { status: 403 });
  }

  const token = await requestToken();
  try {
    const body = await readJson(req);
    const resp = await fetch(`${backendBaseUrl()}/api/admin/users/batch-delete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    const data = (await resp.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "服务暂不可用" }, { status: 503 });
  }
}
