import { NextRequest, NextResponse } from "next/server";
import { currentUser, backendBaseUrl, requestToken } from "@/core/auth";
import { assertOrigin, readJson } from "@/core/api";

export const dynamic = "force-dynamic";

/** 代理到后端：更新/删除用户（仅管理员） */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

  const { id } = await params;
  const token = await requestToken();
  try {
    const body = await readJson(req);
    const resp = await fetch(`${backendBaseUrl()}/api/admin/users/${id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    const data = (await resp.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!data.ok) {
      return NextResponse.json(data, { status: 400 });
    }
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "服务暂不可用" }, { status: 503 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

  const { id } = await params;
  const token = await requestToken();
  try {
    const resp = await fetch(`${backendBaseUrl()}/api/admin/users/${id}`, {
      method: "DELETE",
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      cache: "no-store",
    });

    const data = (await resp.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!data.ok) {
      return NextResponse.json(data, { status: 400 });
    }
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "服务暂不可用" }, { status: 503 });
  }
}
