import { currentUser } from "@/core/auth";
import { row, rows } from "@/core/db";
import NoticesView from "@/components/notices/NoticesView";
import type { NoticeRow } from "@/components/notices/NoticesView";

export const dynamic = "force-dynamic";

export default async function NoticesPage() {
  await currentUser();

  // 初始渲染：第一页（全部类型，仅已发布，置顶优先 + 时间倒序）
  const [notices, count] = await Promise.all([
    rows<NoticeRow>(
      `
      SELECT n.*, u.display_name AS publisher_name
      FROM notice n
      LEFT JOIN users u ON u.id = n.publisher_id
      WHERE n.status = 'published'
      ORDER BY n.is_pinned DESC, n.publish_time DESC, n.id DESC
      LIMIT 10
      `
    ),
    row<{ c: number }>("SELECT COUNT(*) AS c FROM notice WHERE status = 'published'"),
  ]);

  return <NoticesView initialNotices={notices} initialTotal={count?.c ?? notices.length} />;
}
