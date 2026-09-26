import { NextResponse } from "next/server";
import { rows } from "@/core/db";
import { requireUser, jsonError } from "@/core/api";

/**
 * 群历史消息（只读，chat-module v2）：与后端 GET /api/chat/groups/{conversationId}/messages 响应结构一致。
 * 越权防线：第一步校验 me ∈ chat_conversation_members 且会话 type='group'，非成员直接拒绝——
 * 不存在任何绕过成员校验的 conversationId 裸查；SQL 全参数化。
 * 每条消息带 senderName（LEFT JOIN users 批量回查，避免 N+1）。
 */

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

export async function GET(req: Request, { params }: { params: Promise<{ conversationId: string }> }) {
  const user = await requireUser();
  if (!user) return jsonError("未登录", 401);
  const meId = user.id;

  const { conversationId: conversationIdRaw } = await params;
  const conversationId = Number(conversationIdRaw);
  if (!Number.isInteger(conversationId) || conversationId <= 0) {
    return jsonError("conversationId 参数非法", 400);
  }

  const url = new URL(req.url);
  const beforeIdRaw = url.searchParams.get("beforeId");
  const afterIdRaw = url.searchParams.get("afterId");
  const limitRaw = Number(url.searchParams.get("limit") || DEFAULT_LIMIT);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : DEFAULT_LIMIT));
  const beforeId = beforeIdRaw ? Number(beforeIdRaw) : null;
  const afterId = afterIdRaw ? Number(afterIdRaw) : null;
  if ((beforeId != null && !Number.isFinite(beforeId)) || (afterId != null && !Number.isFinite(afterId))) {
    return jsonError("beforeId/afterId 参数非法", 400);
  }

  try {
    // 越权防线：成员校验（非成员直接 NOT_MEMBER 语义拒绝）
    const member = await rows<{ id: number }>(
      `SELECT id FROM chat_conversation_members WHERE conversation_id = ? AND user_id = ? LIMIT 1`,
      [conversationId, meId]
    );
    const conv = await rows<{ id: number }>(
      `SELECT id FROM chat_conversations WHERE id = ? AND type = 'group' LIMIT 1`,
      [conversationId]
    );
    if (member.length === 0 || conv.length === 0) {
      return jsonError("NOT_MEMBER", 403);
    }

    type GroupMessageRow = {
      id: number;
      conversation_id: number;
      sender_id: number;
      sender_name: string;
      content: string;
      created_at: string;
    };
    let list: GroupMessageRow[];
    let hasMore = false;
    if (afterId != null) {
      // 断线重连增量补拉（id > afterId，升序）
      list = await rows<GroupMessageRow>(
        `SELECT m.id, m.conversation_id, m.sender_id, m.content, m.created_at,
                COALESCE(NULLIF(u.display_name, ''), u.username, '') AS sender_name
         FROM chat_messages m LEFT JOIN users u ON u.id = m.sender_id
         WHERE m.conversation_id = ? AND m.id > ?
         ORDER BY m.id ASC LIMIT ${limit}`,
        [conversationId, afterId]
      );
    } else if (beforeId != null) {
      // 向上翻页：id < beforeId 的最新 limit+1 条，升序返回
      const fetched = await rows<GroupMessageRow>(
        `SELECT m.id, m.conversation_id, m.sender_id, m.content, m.created_at,
                COALESCE(NULLIF(u.display_name, ''), u.username, '') AS sender_name
         FROM chat_messages m LEFT JOIN users u ON u.id = m.sender_id
         WHERE m.conversation_id = ? AND m.id < ?
         ORDER BY m.id DESC LIMIT ${limit + 1}`,
        [conversationId, beforeId]
      );
      hasMore = fetched.length > limit;
      if (hasMore) fetched.length = limit;
      list = fetched.reverse();
    } else {
      // 默认：最新 limit+1 条，升序返回
      const fetched = await rows<GroupMessageRow>(
        `SELECT m.id, m.conversation_id, m.sender_id, m.content, m.created_at,
                COALESCE(NULLIF(u.display_name, ''), u.username, '') AS sender_name
         FROM chat_messages m LEFT JOIN users u ON u.id = m.sender_id
         WHERE m.conversation_id = ?
         ORDER BY m.id DESC LIMIT ${limit + 1}`,
        [conversationId]
      );
      hasMore = fetched.length > limit;
      if (hasMore) fetched.length = limit;
      list = fetched.reverse();
    }

    const messages = list.map((m) => ({
      id: m.id,
      conversationId: m.conversation_id,
      senderId: m.sender_id,
      senderName: m.sender_name,
      content: m.content,
      createdAt: m.created_at,
    }));
    return NextResponse.json({ ok: true, data: { messages, hasMore } });
  } catch (e) {
    console.error("[chat] 群 messages 查询失败：", (e as Error).message);
    return jsonError("群历史消息查询失败", 500);
  }
}
