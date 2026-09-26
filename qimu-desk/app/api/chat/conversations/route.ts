import { NextResponse } from "next/server";
import { rows } from "@/core/db";
import { requireUser, jsonError } from "@/core/api";

/**
 * 聊天会话列表（只读，chat-module v2）：与后端 GET /api/chat/conversations 响应结构一致。
 * v2：单聊段（a/b 定位 + type='single' 限定）UNION 群段（members 表 user_id=me JOIN type='group'）；
 * 未读双口径（单聊 is_read / 群 last_read_message_id 游标）；lastMessage 补 senderName。
 * 越权防线：仅返回当前用户参与的会话；SQL 全参数化。
 */

export const dynamic = "force-dynamic";

type SingleConvRow = {
  id: number;
  user_a_id: number;
  user_b_id: number;
  last_message_id: number | null;
  last_message_preview: string | null;
  last_message_at: string | null;
};

type GroupConvRow = {
  id: number;
  group_name: string | null;
  owner_id: number | null;
  last_message_id: number | null;
  last_message_preview: string | null;
  last_message_at: string | null;
};

export async function GET() {
  const user = await requireUser();
  if (!user) return jsonError("未登录", 401);
  const meId = user.id;

  try {
    // 单聊段：a/b 定位 + type='single' 限定（防止群消息 is_read=0 误计入单聊未读）
    // v3：排除「我对应侧已从列表移除」的会话（user_a/b_deleted_at 非空；新消息由后端清空恢复）
    const singleConvs = await rows<SingleConvRow>(
      `SELECT id, user_a_id, user_b_id, last_message_id, last_message_preview, last_message_at
       FROM chat_conversations
       WHERE (user_a_id = ? OR user_b_id = ?) AND type = 'single'
             AND ((user_a_id = ? AND user_a_deleted_at IS NULL)
               OR (user_b_id = ? AND user_b_deleted_at IS NULL))
       ORDER BY last_message_at DESC, id DESC`,
      [meId, meId, meId, meId]
    );

    // 群段：成员表 user_id=me JOIN 群会话；v3：排除「我的成员行已删除」的会话
    const groupConvs = await rows<GroupConvRow>(
      `SELECT c.id, c.group_name, c.owner_id, c.last_message_id, c.last_message_preview, c.last_message_at
       FROM chat_conversations c
       JOIN chat_conversation_members m ON m.conversation_id = c.id AND m.user_id = ?
       WHERE c.type = 'group' AND m.deleted_at IS NULL`,
      [meId]
    );

    if (singleConvs.length === 0 && groupConvs.length === 0) {
      return NextResponse.json({ ok: true, data: [] });
    }

    // 单聊未读：is_read = 0 且 sender <> 我（一次 GROUP BY 聚合，仅单聊会话参与）
    const unreadByConv = new Map<number, number>();
    if (singleConvs.length > 0) {
      const convIds = singleConvs.map((c) => c.id);
      const marks = convIds.map(() => "?").join(",");
      const unreadRows = await rows<{ conversation_id: number; cnt: number }>(
        `SELECT conversation_id, COUNT(*) AS cnt
         FROM chat_messages
         WHERE is_read = 0 AND sender_id <> ? AND conversation_id IN (${marks})
         GROUP BY conversation_id`,
        [meId, ...convIds]
      );
      for (const r of unreadRows) unreadByConv.set(Number(r.conversation_id), Number(r.cnt));
    }

    // 群未读（游标口径）：id > 我的 last_read_message_id 且 sender <> 我
    const groupUnreadByConv = new Map<number, number>();
    if (groupConvs.length > 0) {
      const groupIds = groupConvs.map((c) => c.id);
      const marks = groupIds.map(() => "?").join(",");
      const groupUnreadRows = await rows<{ conversation_id: number; cnt: number }>(
        `SELECT m.conversation_id, COUNT(g.id) AS cnt
         FROM chat_conversation_members m
         LEFT JOIN chat_messages g ON g.conversation_id = m.conversation_id
              AND g.id > m.last_read_message_id AND g.sender_id <> m.user_id
         WHERE m.user_id = ? AND m.conversation_id IN (${marks})
         GROUP BY m.conversation_id`,
        [meId, ...groupIds]
      );
      for (const r of groupUnreadRows) groupUnreadByConv.set(Number(r.conversation_id), Number(r.cnt));
    }

    // 群成员数（一次 GROUP BY 聚合）
    const memberCountByConv = new Map<number, number>();
    if (groupConvs.length > 0) {
      const groupIds = groupConvs.map((c) => c.id);
      const marks = groupIds.map(() => "?").join(",");
      const countRows = await rows<{ conversation_id: number; cnt: number }>(
        `SELECT conversation_id, COUNT(*) AS cnt
         FROM chat_conversation_members WHERE conversation_id IN (${marks})
         GROUP BY conversation_id`,
        groupIds
      );
      for (const r of countRows) memberCountByConv.set(Number(r.conversation_id), Number(r.cnt));
    }

    // 单聊对方信息（禁用用户保留历史，online 恒为 false）
    const peerIds = [...new Set(singleConvs.map((c) => (c.user_a_id === meId ? c.user_b_id : c.user_a_id)))];
    const peerById = new Map<number, { username: string; displayName: string }>();
    if (peerIds.length > 0) {
      const marks = peerIds.map(() => "?").join(",");
      const peerRows = await rows<{ id: number; username: string; display_name: string | null }>(
        `SELECT id, username, display_name FROM users WHERE id IN (${marks})`,
        peerIds
      );
      for (const p of peerRows) {
        peerById.set(p.id, {
          username: p.username,
          displayName:
            p.display_name && String(p.display_name).trim() !== "" ? p.display_name : p.username,
        });
      }
    }

    // 最近消息（senderId / senderName / createdAt 展示用；LEFT JOIN users 批量回查昵称）
    const lastMsgIds = [
      ...singleConvs.map((c) => c.last_message_id),
      ...groupConvs.map((c) => c.last_message_id),
    ].filter((v): v is number => v != null);
    const lastMsgById = new Map<
      number,
      { sender_id: number; sender_name: string; created_at: string }
    >();
    if (lastMsgIds.length > 0) {
      const marks = lastMsgIds.map(() => "?").join(",");
      const lastMsgRows = await rows<{
        id: number;
        sender_id: number;
        created_at: string;
        username: string | null;
        display_name: string | null;
      }>(
        `SELECT m.id, m.sender_id, m.created_at, u.username, u.display_name
         FROM chat_messages m LEFT JOIN users u ON u.id = m.sender_id
         WHERE m.id IN (${marks})`,
        lastMsgIds
      );
      for (const m of lastMsgRows) {
        lastMsgById.set(m.id, {
          sender_id: m.sender_id,
          sender_name:
            m.display_name && String(m.display_name).trim() !== "" ? m.display_name : m.username || "",
          created_at: m.created_at,
        });
      }
    }

    // 组装：单聊项 = v1 结构 + type/senderName；群项 = group:{name,memberCount,ownerId}
    const data: Array<Record<string, unknown>> = [];
    for (const c of singleConvs) {
      const peerId = c.user_a_id === meId ? c.user_b_id : c.user_a_id;
      const peer = peerById.get(peerId);
      const lm = c.last_message_id != null ? lastMsgById.get(c.last_message_id) : undefined;
      data.push({
        conversationId: c.id,
        type: "single",
        peer: { id: peerId, username: peer?.username || "", displayName: peer?.displayName || "", online: false },
        unread: unreadByConv.get(c.id) ?? 0,
        lastMessage: lm
          ? {
              id: c.last_message_id as number,
              preview: c.last_message_preview || "",
              senderId: lm.sender_id,
              senderName: lm.sender_name,
              createdAt: lm.created_at,
            }
          : null,
        lastMessageAt: c.last_message_at,
      });
    }
    for (const c of groupConvs) {
      const lm = c.last_message_id != null ? lastMsgById.get(c.last_message_id) : undefined;
      data.push({
        conversationId: c.id,
        type: "group",
        group: {
          name: c.group_name || "",
          memberCount: memberCountByConv.get(c.id) ?? 0,
          ownerId: c.owner_id,
        },
        unread: groupUnreadByConv.get(c.id) ?? 0,
        lastMessage: lm
          ? {
              id: c.last_message_id as number,
              preview: c.last_message_preview || "",
              senderId: lm.sender_id,
              senderName: lm.sender_name,
              createdAt: lm.created_at,
            }
          : null,
        lastMessageAt: c.last_message_at,
      });
    }

    // 合并排序：lastMessageAt 倒序，其次 conversationId 倒序
    data.sort((a, b) => {
      const ta = (a.lastMessageAt as string | null) || "";
      const tb = (b.lastMessageAt as string | null) || "";
      if (ta !== tb) return ta < tb ? 1 : -1;
      return (b.conversationId as number) - (a.conversationId as number);
    });

    return NextResponse.json({ ok: true, data });
  } catch (e) {
    console.error("[chat] conversations 查询失败：", (e as Error).message);
    return jsonError("会话列表查询失败", 500);
  }
}
