import { NextResponse } from "next/server";
import { row } from "@/core/db";
import { requireUser, jsonError } from "@/core/api";

export const dynamic = "force-dynamic";

/**
 * 通知公告只读详情（全员登录用户）。
 * 硬约束：仅返回 status='published' 的记录；只实现 GET，不提供任何写方法。
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireUser();
  if (!user) return jsonError("未登录", 401);

  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isInteger(id) || id < 1) return jsonError("无效 ID", 400);

  const notice = await row(
    `
    SELECT n.*, u.display_name AS publisher_name
    FROM notice n
    LEFT JOIN users u ON u.id = n.publisher_id
    WHERE n.id = ? AND n.status = 'published'
    `,
    [id]
  );
  if (!notice) return jsonError("通知不存在", 404);

  return NextResponse.json({ notice });
}
