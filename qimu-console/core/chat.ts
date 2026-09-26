/**
 * 消息会话管理共享约定（admin 端，chat-admin-module）
 *
 * 原工作台端聊天组件（ChatWorkspace / WS 链路）已下线，本文件仅保留
 * 「消息会话管理」页（components/ChatAdminManager.tsx）所需的取数封装与类型。
 * REST 全部走现有 next.config /api/* rewrite 到后端 :8080（同源，cookie token 自动携带）。
 */

// ---------- 数据模型（与后端 ChatAdminController 响应字段一一对应） ----------

export type ChatAdminParticipant = {
  id: number;
  username: string;
  displayName: string;
};

/** v2：群会话信息（type='group' 时存在；单聊项无此字段） */
export type ChatAdminGroupInfo = {
  name: string;
  memberCount: number;
  ownerId: number;
};

export type ChatAdminConversation = {
  conversationId: number;
  /** single | group */
  type: "single" | "group";
  /** 单聊项返回双方参与者 */
  participants?: ChatAdminParticipant[];
  /** 群聊项返回群信息 */
  group?: ChatAdminGroupInfo;
  messageCount: number;
  lastMessagePreview: string;
  lastMessageAt: string | null;
};

export type ChatAdminMessage = {
  id: number;
  conversationId: number;
  senderId: number;
  /** displayName 为空回退 username */
  senderName: string;
  content: string;
  /** "yyyy-MM-dd HH:mm:ss" */
  createdAt: string;
  isRead: number;
};

// ---------- REST 路径（与后端 ChatAdminController 一致，chatApiFetch 已带 /api/chat 前缀） ----------

export const CHAT_ADMIN_API = {
  /** GET /api/chat/admin/conversations?page&size&type&keyword */
  conversations: "/admin/conversations",
  /** GET /api/chat/admin/conversations/{id}/messages?beforeId&limit */
  messages: (conversationId: number) => `/admin/conversations/${conversationId}/messages`,
  /** DELETE /api/chat/admin/conversations/{id} */
  remove: (conversationId: number) => `/admin/conversations/${conversationId}`,
} as const;

// ---------- REST（全部经 /api rewrite 同源调用，浏览器自动携带 token cookie） ----------

/** 调用后端聊天 REST（返回统一为 Result{ok,data,error} 解包后的 data） */
export async function chatApiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/chat${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = (await res.json().catch(() => null)) as
    | { ok?: boolean; data?: T; error?: string }
    | null;
  if (!res.ok || !body || body.ok !== true) {
    throw new Error(body?.error || `请求失败(${res.status})`);
  }
  return body.data as T;
}

// ---------- 展示工具 ----------

/** "yyyy-MM-dd HH:mm:ss" → 气泡时间（当天只显示 HH:mm，跨天显示 MM-DD HH:mm） */
export function formatMessageTime(createdAt: string): string {
  if (!createdAt) return "";
  const [date, time] = createdAt.split(" ");
  const hhmm = (time || "").slice(0, 5);
  const today = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const todayStr = `${today.getFullYear()}-${p(today.getMonth() + 1)}-${p(today.getDate())}`;
  return date === todayStr ? hhmm : `${date.slice(5)} ${hhmm}`;
}
