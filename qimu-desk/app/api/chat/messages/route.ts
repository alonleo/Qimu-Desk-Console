import { NextResponse } from "next/server";
import { rows, row } from "@/core/db";
import { requireUser, jsonError } from "@/core/api";

/**
 * 历史消息（只读，chat-module）：与后端 GET /api/chat/conversations/{peerId}/messages 响应结构一致。
 * 越权防线：会话一律以 (min(me,peerId), max(me,peerId)) 定位，会话不存在即返回空——
 * 不存在任何"按 conversationId 直接读"的入口；SQL 全参数化。
 */

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

export async function GET(req: Request) {
  const user = await requireUser();
  if (!user) return jsonError("未登录", 401);
  const meId = user.id;

  const url = new URL(req.url);
  const peerId = Number(url.searchParams.get("peerId"));
  const beforeIdRaw = url.searchParams.get("beforeId");
  const afterIdRaw = url.searchParams.get("afterId");
  const limitRaw = Number(url.searchParams.get("limit") || DEFAULT_LIMIT);
  if (!Number.isInteger(peerId) || peerId <= 0) {
    return jsonError("peerId 参数非法", 400);
  }
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : DEFAULT_LIMIT));
  const beforeId = beforeIdRaw ? Number(beforeIdRaw) : null;
  const afterId = afterIdRaw ? Number(afterIdRaw) : null;
  if ((beforeId != null && !Number.isFinite(beforeId)) || (afterId != null && !Number.isFinite(afterId))) {
    return jsonError("beforeId/afterId 参数非法", 400);
  }

  try {
    // 会话定位：min/max 归一化；不存在（从未聊过）→ 空消息
    const conv = await row<{ id: number }>(
      `SELECT id FROM chat_conversations WHERE user_a_id = ? AND user_b_id = ?`,
      [Math.min(meId, peerId), Math.max(meId, peerId)]
    );
    if (!conv) {
      return NextResponse.json({ ok: true, data: { messages: [], hasMore: false } });
    }

    type ChatMessageRow = { id: number; conversation_id: number; sender_id: number; content: string; created_at: string };
    let list: ChatMessageRow[];
    let hasMore = false;
    if (afterId != null) {
      // 断线重连增量补拉（id > afterId，升序）
      list = await rows<ChatMessageRow>(
        `SELECT id, conversation_id, sender_id, content, created_at
         FROM chat_messages WHERE conversation_id = ? AND id > ?
         ORDER BY id ASC LIMIT ${limit}`,
        [conv.id, afterId]
      );
    } else if (beforeId != null) {
      // 向上翻页：id < beforeId 的最新 limit+1 条，升序返回
      const fetched = await rows<ChatMessageRow>(
        `SELECT id, conversation_id, sender_id, content, created_at
         FROM chat_messages WHERE conversation_id = ? AND id < ?
         ORDER BY id DESC LIMIT ${limit + 1}`,
        [conv.id, beforeId]
      );
      hasMore = fetched.length > limit;
      if (hasMore) fetched.length = limit;
      list = fetched.reverse();
    } else {
      // 默认：最新 limit+1 条，升序返回
      const fetched = await rows<ChatMessageRow>(
        `SELECT id, conversation_id, sender_id, content, created_at
         FROM chat_messages WHERE conversation_id = ?
         ORDER BY id DESC LIMIT ${limit + 1}`,
        [conv.id]
      );
      hasMore = fetched.length > limit;
      if (hasMore) fetched.length = limit;
      list = fetched.reverse();
    }

    const messages = list.map((m) => ({
      id: m.id,
      conversationId: m.conversation_id,
      senderId: m.sender_id,
      content: m.content,
      createdAt: m.created_at,
    }));
    return NextResponse.json({ ok: true, data: { messages, hasMore } });
  } catch (e) {
    console.error("[chat] messages 查询失败：", (e as Error).message);
    return jsonError("历史消息查询失败", 500);
  }
}
