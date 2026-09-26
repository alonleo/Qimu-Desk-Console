import { NextRequest, NextResponse } from "next/server";
import {
  PREVIEW_COOKIE,
  previewEnabled,
  localRequest,
  validPreviewPassword,
  previewSession,
  previewCookieOptions,
} from "@/core/local-preview";
export const dynamic = "force-dynamic";
// A separate cookie and route never grant access to real application APIs.
let attempts = { count: 0, reset: 0 };
export async function POST(req: NextRequest) {
  if (!previewEnabled() || !localRequest(req.headers))
    return NextResponse.json({ error: "本地预览未启用" }, { status: 404 });
  const now = Date.now();
  if (now >= attempts.reset) attempts = { count: 0, reset: now + 60_000 };
  if (++attempts.count > 10)
    return NextResponse.json(
      { error: "尝试次数过多，请一分钟后重试" },
      { status: 429 },
    );
  const body = await req.json().catch(() => null);
  if (!validPreviewPassword(body?.username, body?.password))
    return NextResponse.json({ error: "临时账号或密码错误" }, { status: 401 });
  const res = NextResponse.json({ ok: true, preview: true });
  res.cookies.set(PREVIEW_COOKIE, previewSession(), previewCookieOptions);
  return res;
}
export async function DELETE(req: NextRequest) {
  if (!previewEnabled() || !localRequest(req.headers))
    return NextResponse.json({ error: "本地预览未启用" }, { status: 404 });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(PREVIEW_COOKIE, "", { ...previewCookieOptions, maxAge: 0 });
  return res;
}
