import { NextResponse } from "next/server";
import { rows, row } from "@/core/db";
import { requireUser, jsonError } from "@/core/api";

/**
 * 通知待处理摘要（只读，notice 模块）：AppShell 铃铛角标 / 公告强制阅读 / 通知顶部弹窗的数据源。
 * 未读口径：published 且无本人在 notice_read 中的回执。
 * 公告全量（强制阅读不能漏，上限 50）；通知最多 20 条；unreadTotal 为两类未读总数。
 */

export const dynamic = "force-dynamic";

const UNREAD_WHERE =
  "n.status = 'published' AND NOT EXISTS (SELECT 1 FROM notice_read r WHERE r.notice_id = n.id AND r.user_id = ?)";

export async function GET() {
  const user = await requireUser();
  if (!user) return jsonError("未登录", 401);
  const meId = user.id;

  try {
    const [announcements, notifications, total] = await Promise.all([
      rows(
        `SELECT n.*, u.display_name AS publisher_name
         FROM notice n LEFT JOIN users u ON u.id = n.publisher_id
         WHERE ${UNREAD_WHERE} AND n.type = 'announcement'
         ORDER BY n.is_pinned DESC, n.publish_time DESC, n.id DESC
         LIMIT 50`,
        [meId]
      ),
      rows(
        `SELECT n.*, u.display_name AS publisher_name
         FROM notice n LEFT JOIN users u ON u.id = n.publisher_id
         WHERE ${UNREAD_WHERE} AND n.type = 'notification'
         ORDER BY n.is_pinned DESC, n.publish_time DESC, n.id DESC
         LIMIT 20`,
        [meId]
      ),
      row<{ c: number }>(`SELECT COUNT(*) AS c FROM notice n WHERE ${UNREAD_WHERE}`, [meId]),
    ]);

    return NextResponse.json({
      ok: true,
      data: {
        announcements,
        notifications,
        unreadTotal: Number(total?.c ?? 0),
      },
    });
  } catch (e) {
    console.error("[notices] pending 查询失败：", (e as Error).message);
    return jsonError("通知状态查询失败", 500);
  }
}
