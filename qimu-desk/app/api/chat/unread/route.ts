import { NextResponse } from "next/server";
import { rows, row } from "@/core/db";
import { requireUser, jsonError } from "@/core/api";

/**
 * 未读总数（只读，chat-module v2）：侧边栏角标 30s 轮询用，保持轻量 COUNT 聚合。
 * v2 双口径：total = 单聊（is_read=0 且 sender<>me，限定 type='single' 会话）
 *          + 群聊（成员游标：id > last_read_message_id 且 sender<>me）。
 */

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await requireUser();
  if (!user) return jsonError("未登录", 401);
  const meId = user.id;

  try {
    // 单聊口径（v2 关键限定：仅 type='single' 会话参与统计）
    // v3：已从列表移除（我对应侧 user_a/b_deleted_at 非空）的会话不计入未读
    const single = await row<{ c: number }>(
      `SELECT COUNT(*) AS c
       FROM chat_messages m
       JOIN chat_conversations c2 ON c2.id = m.conversation_id
       WHERE (c2.user_a_id = ? OR c2.user_b_id = ?) AND c2.type = 'single'
             AND ((c2.user_a_id = ? AND c2.user_a_deleted_at IS NULL)
               OR (c2.user_b_id = ? AND c2.user_b_deleted_at IS NULL))
             AND m.sender_id <> ? AND m.is_read = 0`,
      [meId, meId, meId, meId, meId]
    );

    // 群口径（成员游标 JOIN）；v3：我的成员行已删除的群不计入未读
    const group = await row<{ c: number }>(
      `SELECT COUNT(*) AS c
       FROM chat_conversation_members mm
       JOIN chat_conversations cc ON cc.id = mm.conversation_id AND cc.type = 'group'
       JOIN chat_messages g ON g.conversation_id = mm.conversation_id
            AND g.id > mm.last_read_message_id AND g.sender_id <> mm.user_id
       WHERE mm.user_id = ? AND mm.deleted_at IS NULL`,
      [meId]
    );

    const total = Number(single?.c ?? 0) + Number(group?.c ?? 0);
    return NextResponse.json({ ok: true, data: { total } });
  } catch (e) {
    console.error("[chat] unread 查询失败：", (e as Error).message);
    return jsonError("未读数查询失败", 500);
  }
}
