/**
 * 聊天模块共享约定（workbench 端，chat-module）
 *
 * 协议常量与后端 admin-backend ChatWebSocketHandler / common/ChatSupport 保持一致，
 * 两端前端（workbench / admin）的 core/chat.ts 结构相同、代码各自独立，改动需三处同步。
 *
 * 写路径约定（架构文档 §1.3）：消息落库只发生在后端——
 * - 本地 Route Handler（/api/chat/*）只承担只读查询（conversations / messages / unread / ws-ticket / 群消息）；
 * - 写请求（发送 / 已读 / 建群 / 群成员）经 chatApiFetch 打到后端 REST：
 *   dev：NEXT_PUBLIC_CHAT_API_BASE=http://localhost:8080 → 直连 :8080/api/chat/*（需 CORS）；
 *   prod：NEXT_PUBLIC_CHAT_API_BASE 不设 → 同源 /api/backend/chat/*，由 OpenResty 转发到 :8080/api/chat/*。
 */

/** 消息内容长度上限（trim 后 1~2000 字符，与后端 ChatSupport.CONTENT_MAX 一致） */
export const CONTENT_MAX = 2000;
/** 群名长度上限（trim 后 1~30 字符，与后端 ChatSupport.GROUP_NAME_MAX 一致） */
export const GROUP_NAME_MAX = 30;
/** 群成员上限（含创建者，与后端 ChatSupport.GROUP_MAX_MEMBERS 一致） */
export const GROUP_MAX_MEMBERS = 50;

/** WS 连接状态 */
export type WsStatus = "connecting" | "open" | "closed";

// ---------- 数据模型（与后端 REST 响应字段一一对应） ----------

export type ChatConversationType = "single" | "group";

export type ChatContact = {
  id: number;
  username: string;
  displayName: string | null;
  role: string;
  online: boolean;
  lastOnlineAt: string | null;
};

export type ChatPeer = {
  id: number;
  username: string;
  displayName: string;
  online: boolean;
};

/** v2：群会话信息（type='group' 时存在；单聊项无此字段） */
export type ChatGroupInfo = {
  name: string;
  memberCount: number;
  ownerId: number;
};

export type ChatLastMessage = {
  id: number;
  preview: string;
  senderId: number;
  /** v2：发送者昵称（群摘要发言人前缀由前端拼接：senderId===me ? "我" : senderName） */
  senderName?: string;
  createdAt: string;
};

export type ChatConversationItem = {
  conversationId: number;
  /** v2：single | group（老字段 peer 仅单聊项返回；群项为 group） */
  type: ChatConversationType;
  peer?: ChatPeer;
  group?: ChatGroupInfo;
  unread: number;
  lastMessage: ChatLastMessage | null;
  lastMessageAt: string | null;
};

export type ChatMessageItem = {
  id: number;
  conversationId: number;
  senderId: number;
  /** v2：群消息发送者昵称（单聊无此字段，气泡按会话对方展示） */
  senderName?: string;
  content: string;
  createdAt: string;
};

/** 展示层消息：服务端消息 + 乐观 pending 消息合并后渲染（禁用 dangerouslySetInnerHTML） */
export type ChatDisplayMessage = ChatMessageItem & { pending?: boolean; clientId?: string };

// ---------- v2：会话定位双态（单聊按 peerId / 群聊按 conversationId） ----------

export type ChatActiveConv =
  | { kind: "single"; peerId: number }
  | { kind: "group"; conversationId: number };

// ---------- v2：群 REST 路径（与后端 ChatGroupController 一致） ----------

export const CHAT_GROUP_API = {
  /** POST /api/chat/groups  body {name, memberIds} */
  create: "/groups",
  members: (conversationId: number) => `/groups/${conversationId}/members`,
  messages: (conversationId: number) => `/groups/${conversationId}/messages`,
  read: (conversationId: number) => `/groups/${conversationId}/read`,
} as const;

// ---------- WS 帧协议（与后端 ChatSupport 常量一致，改动需同步） ----------

export type ChatErrorCode =
  | "BAD_FRAME"
  | "PEER_NOT_FOUND"
  | "PEER_DISABLED"
  | "CONTENT_INVALID"
  | "INTERNAL"
  // v2 新增
  | "NOT_MEMBER"
  | "GROUP_NAME_INVALID"
  | "GROUP_FULL"
  | "MEMBER_INVALID";

export type ChatFrame =
  | { type: "hello"; ts: number; userId: number; onlineIds: number[] }
  | {
      type: "chat";
      ts: number;
      messageId: number;
      conversationId: number;
      clientId: string;
      from: number;
      fromName: string;
      /** v1 单聊帧有 to；v2 群帧无 to（前端按 conversationType 分支，不得依赖群帧 to） */
      to?: number;
      content: string;
      createdAt: string;
      /** v2 新增：single | group（老帧无此字段时按 single 处理） */
      conversationType?: ChatConversationType;
    }
  | { type: "read"; ts: number; peerId: number; conversationId: number; lastReadMessageId: number }
  | { type: "online"; ts: number; userId: number; online: boolean; at: string }
  | { type: "pong"; ts: number }
  | {
      /** v2 新增：群创建广播，前端收到后统一 loadConversations() 全量刷新 */
      type: "new_conversation";
      ts: number;
      conversationId: number;
      conversationType: ChatConversationType;
      name: string;
      memberCount: number;
    }
  | { type: "error"; ts: number; code: ChatErrorCode; message: string };

// ---------- token 获取（workbench：wb_token HttpOnly → 本地 ws-ticket 接口回吐） ----------

let cachedWsToken: string | null = null;

/** 获取用于 WS 握手/后端写请求的 JWT（本域 HttpOnly cookie 经服务端接口回吐） */
export async function getWsToken(): Promise<string> {
  if (cachedWsToken) return cachedWsToken;
  const res = await fetch("/api/chat/ws-ticket", { cache: "no-store" });
  const body = (await res.json().catch(() => null)) as
    | { ok?: boolean; data?: { token?: string }; error?: string }
    | null;
  const token = body?.data?.token;
  if (!res.ok || body?.ok !== true || !token) {
    throw new Error(body?.error || "获取会话凭据失败");
  }
  cachedWsToken = token;
  return token;
}

// ---------- WS 地址解析（NEXT_PUBLIC_WS_BASE 优先，否则同域 ws(s)://host/ws/chat） ----------

export function resolveWsUrl(token: string): string {
  const base = (process.env.NEXT_PUBLIC_WS_BASE || "").replace(/\/+$/, "");
  const url = base
    ? `${base}/ws/chat`
    : `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws/chat`;
  return `${url}?token=${encodeURIComponent(token)}`;
}

// ---------- 后端写请求（发送 / 已读 / 建群兜底；dev 直连、prod 同源反代） ----------

const CHAT_API_BASE = (process.env.NEXT_PUBLIC_CHAT_API_BASE || "").replace(/\/+$/, "");
const CHAT_API_PREFIX = CHAT_API_BASE ? `${CHAT_API_BASE}/api/chat` : "/api/backend/chat";

/** 调用后端聊天 REST（写请求与群成员列表读走这里；返回统一为 Result.data） */
export async function chatApiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getWsToken();
  const res = await fetch(`${CHAT_API_PREFIX}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
  const body = (await res.json().catch(() => null)) as
    | { ok?: boolean; data?: T; error?: string }
    | null;
  if (!res.ok || !body || body.ok !== true) {
    throw new Error(body?.error || `后端请求失败(${res.status})`);
  }
  return body.data as T;
}

// ---------- 本地只读请求（Next Route Handler 直连 MySQL） ----------

/** 调用 workbench 本地只读聊天接口（返回 {ok:true,data} 的 data 部分） */
export async function localChatFetch<T>(path: string, init?: RequestInit): Promise<T> {
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

// ---------- 输入校验（与后端同步：trim 后 1~2000 字符） ----------

/** 校验并规范化输入内容；非法返回 null（前端禁用发送按钮/提示） */
export function sanitizeContent(raw: string): string | null {
  const s = raw.trim();
  if (s.length === 0 || s.length > CONTENT_MAX) return null;
  return s;
}

/** v2：校验并规范化群名（trim 后 1~30 字符）；非法返回 null */
export function sanitizeGroupName(raw: string): string | null {
  const s = raw.trim();
  if (s.length === 0 || s.length > GROUP_NAME_MAX) return null;
  return s;
}

/** "yyyy-MM-dd HH:mm:ss" → 气泡时间（当天只显示 HH:mm，跨天显示 MM-DD HH:mm） */
export function formatMessageTime(createdAt: string): string {
  if (!createdAt) return "";
  const [date, time] = createdAt.split(/[T ]/);
  const hhmm = (time || "").slice(0, 5);
  const today = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const todayStr = `${today.getFullYear()}-${p(today.getMonth() + 1)}-${p(today.getDate())}`;
  return date === todayStr ? hhmm : `${date.slice(5)} ${hhmm}`;
}
