import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/core/auth";
import { row } from "@/core/db";
import { readJson } from "@/core/api";

export const dynamic = "force-dynamic";

/** GET /api/profile - 获取当前用户资料 */
export async function GET() {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  return NextResponse.json({ user });
}

/** PATCH /api/profile - 更新当前用户资料（displayName） */
export async function PATCH(req: NextRequest) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const body = await readJson(req) as { displayName?: string };
  const displayName = body.displayName?.trim() || null;

  await row(
    "UPDATE users SET display_name = ?, updated_at = NOW() WHERE id = ?",
    [displayName, user.id]
  );

  return NextResponse.json({ ok: true });
}
