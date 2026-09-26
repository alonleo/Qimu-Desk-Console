import { NextResponse } from "next/server";
import { rows, escapeLike } from "@/core/db";
import { requireUser, jsonError } from "@/core/api";

export const dynamic = "force-dynamic";

const VALID_TABS = ["all", "announcement", "notification"];

/**
 * 通知公告只读分页列表（全员登录用户）。
 * 硬约束：仅返回 status='published'；只实现 GET，不提供任何写方法。
 * 排序铁律：is_pinned DESC, publish_time DESC, id DESC。
 */
export async function GET(req: Request) {
  const user = await requireUser();
  if (!user) return jsonError("未登录", 401);

  const url = new URL(req.url);
  const tab = url.searchParams.get("tab") || "all";
  const title = (url.searchParams.get("title") || "").trim();
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize")) || 10));
  if (!VALID_TABS.includes(tab)) return jsonError("无效的类型筛选", 400);

  let where = "WHERE n.status = 'published'";
  const params: (string | number)[] = [];
  if (tab !== "all") {
    where += " AND n.type = ?";
    params.push(tab);
  }
  if (title) {
    where += " AND n.title LIKE ?";
    params.push(`%${escapeLike(title)}%`);
  }

  const countRows = await rows<{ c: number }>(
    `SELECT COUNT(*) AS c FROM notice n ${where}`,
    params
  );
  const total = countRows[0]?.c ?? 0;

  const notices = await rows(
    `
    SELECT n.*, u.display_name AS publisher_name
    FROM notice n
    LEFT JOIN users u ON u.id = n.publisher_id
    ${where}
    ORDER BY n.is_pinned DESC, n.publish_time DESC, n.id DESC
    LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
    `,
    params
  );

  return NextResponse.json({ total, page, pageSize, notices });
}
