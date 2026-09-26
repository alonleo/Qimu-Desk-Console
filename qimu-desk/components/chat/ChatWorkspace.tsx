"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, App, Button, Drawer } from "antd";
import { PlusOutlined, TeamOutlined } from "@ant-design/icons";
import ConversationList, { type SelectablePeer } from "./ConversationList";
import MessagePanel, { type ActiveHeader } from "./MessagePanel";
import OnlinePanel from "./OnlinePanel";
import CreateGroupModal from "./CreateGroupModal";
import { useChatWebSocket, type ChatSendFrame } from "./useChatWebSocket";
import type {
  ChatActiveConv,
  ChatContact,
  ChatConversationItem,
  ChatDisplayMessage,
  ChatMessageItem,
} from "@/core/chat";
import { CHAT_GROUP_API, chatApiFetch, localChatFetch, sanitizeContent } from "@/core/chat";

/**
 * 聊天页主体：会话列表与聊天区两栏布局，联系人按需在抽屉展开。
 *
 * 数据流约定（与架构文档 §1.3/§1.4/§1.5 一致）：
 * - 读：会话列表/历史消息走本地只读 Handler（db 直连），联系人/在线状态走后端 REST；
 * - 写：主路径 WS 发送；WS 未连接时 chatApiFetch 打后端 REST 兜底（HTTP 兜底同样推送）；
 * - 寻址：会话尚不存在（在线面板开新单聊）用 to；已有会话用 conversationId（单/群通用）；
 * - hello：全量刷新会话列表 + 在线状态，并对当前打开会话按 afterId 增量补拉；
 * - chat 帧：前端一律 conversationType ?? "single" 分支，群帧不依赖 to 字段；
 * - 群已读：REST POST /groups/{id}/read（无 read 帧）；单聊已读保持 WS read 帧主路径；
 * - new_conversation 帧：统一 loadConversations() 全量刷新（不做局部拼接）；
 * - 侧边栏未读角标由 AppShell 30s 轮询承担，聊天页内未读由 WS read/chat 帧驱动。
 */

type Props = {
  meId: number;
  meName: string;
};

function newClientId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function ChatWorkspace({ meId, meName }: Props) {
  const { message } = App.useApp();

  const [contacts, setContacts] = useState<ChatContact[]>([]);
  const [conversations, setConversations] = useState<ChatConversationItem[]>([]);
  const [messages, setMessages] = useState<ChatMessageItem[]>([]);
  const [pendings, setPendings] = useState<{ clientId: string; content: string }[]>([]);
  const [activeConv, setActiveConv] = useState<ChatActiveConv | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadingList, setLoadingList] = useState(true);
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [onlinePanelOpen, setOnlinePanelOpen] = useState(false);

  const [listError, setListError] = useState(false);
  const [contactsError, setContactsError] = useState(false);
  const [historyError, setHistoryError] = useState(false);
  const historyRequest = useRef(0);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const activeKey = activeConv ? activeConv.kind === "single" ? `single-${activeConv.peerId}` : `group-${activeConv.conversationId}` : "";

  // WS API 桥接 ref：send/sendFrame/markRead 在 hook 调用之后才存在，回调经此转发
  const wsRef = useRef<{
    send: (to: number, content: string, clientId: string) => boolean;
    sendFrame: (frame: ChatSendFrame) => boolean;
    markRead: (peerId: number) => boolean;
  } | null>(null);

  // 便捷 ref：回调内读取最新值，避免闭包过期
  const activeConvRef = useRef<ChatActiveConv | null>(null);
  activeConvRef.current = activeConv;
  const messagesRef = useRef<ChatMessageItem[]>([]);
  messagesRef.current = messages;

  const notify = useCallback(
    (content: string) => {
      try {
        void message.info(content);
      } catch {
        /* 忽略提示失败 */
      }
    },
    [message]
  );

  // ---------- 数据加载 ----------

  const loadConversations = useCallback(async () => {
    setListError(false);
    try {
      const data = await localChatFetch<ChatConversationItem[]>("/conversations");
      setConversations(data);
    } catch (e) {
      setListError(true);
      console.error("[chat] 会话列表加载失败:", e);
    } finally {
      setLoadingList(false);
    }
  }, []);

  const loadContacts = useCallback(async () => {
    try {
      const data = await chatApiFetch<ChatContact[]>("/contacts");
      setContacts(data.filter(c => c.id !== meId));
      setContactsError(false);
    } catch (e) {
      setContactsError(true);
      console.error("[chat] 联系人加载失败:", e);
    }
  }, [meId]);

  /**
   * v3：删除会话（单个/批量）：微信式「仅从我的列表移除」。
   * 写路径统一走后端 POST /conversations/delete（body {ids}）；成功后本地移除这些项，
   * 被删会话为当前打开会话时关闭面板；失败提示异常信息。
   */
  const handleDeleteConversations = useCallback(
    async (ids: number[]) => {
      if (ids.length === 0) return;
      try {
        const data = await chatApiFetch<{ deleted: number }>("/conversations/delete", {
          method: "POST",
          body: JSON.stringify({ ids }),
        });
        const idSet = new Set(ids);
        const removed = conversations.filter((c) => idSet.has(c.conversationId));
        setConversations((prev) => prev.filter((c) => !idSet.has(c.conversationId)));
        const conv = activeConvRef.current;
        const activeDeleted =
          conv != null &&
          removed.some((c) =>
            conv.kind === "single"
              ? c.type === "single" && c.peer?.id === conv.peerId
              : c.type === "group" && c.conversationId === conv.conversationId
          );
        if (activeDeleted) {
          ++historyRequest.current;
          activeConvRef.current = null;
          setActiveConv(null);
        }
        void message.success(`已删除 ${data.deleted} 个会话`);
      } catch (e) {
        void message.error(e instanceof Error ? e.message : "删除会话失败");
      }
    },
    [conversations, message]
  );

  /** 单聊已读：主路径 WS read 帧；WS 不可达走 HTTP 兜底（后端负责推送对方） */
  const markReadSingle = useCallback((peerId: number) => {
    if (!wsRef.current?.markRead(peerId)) {
      void chatApiFetch<{ cleared: number }>(`/conversations/${peerId}/read`, { method: "POST" }).catch(() => {
        /* 失败时由角标轮询兜底修正 */
      });
    }
  }, []);

  /** v2 群已读：REST 落成员游标（本期无 read 帧，不广播） */
  const markGroupRead = useCallback((conversationId: number) => {
    void chatApiFetch<{ cursor: number }>(CHAT_GROUP_API.read(conversationId), { method: "POST" }).catch(() => {
      /* 失败时由角标轮询兜底修正 */
    });
  }, []);

  const openSingle = useCallback(
    async (peer: SelectablePeer) => {
      const request = ++historyRequest.current;
      setHistoryError(false);
      setLoadingMore(false);
      activeConvRef.current = { kind: "single", peerId: peer.id };
      setActiveConv(activeConvRef.current);
      setMessages([]);
      setPendings([]);
      setHasMore(false);
      setLoadingHistory(true);
      try {
        const data = await localChatFetch<{ messages: ChatMessageItem[]; hasMore: boolean }>(
          `/messages?peerId=${peer.id}`
        );
        if (request !== historyRequest.current) return;
        setMessages(prev => [...new Map([...data.messages, ...prev].map(m => [m.id, m])).values()].sort((a, b) => a.id - b.id));
        setHasMore(data.hasMore);
      } catch (e) {
        if (request !== historyRequest.current) return;
        setHistoryError(true);
        console.error("[chat] 历史消息加载失败:", e);
        return;
      } finally {
        if (request === historyRequest.current) setLoadingHistory(false);
      }
      // 进入会话未读清零（DB 由 WS read 帧 / HTTP read 兜底落库）
      setConversations((prev) =>
        prev.map((c) => (c.type === "single" && c.peer?.id === peer.id ? { ...c, unread: 0 } : c))
      );
      markReadSingle(peer.id);
    },
    [markReadSingle]
  );

  /** v2：打开群会话（群历史读走本地只读 Handler，已读走 REST） */
  const openGroup = useCallback(
    async (conversationId: number) => {
      const request = ++historyRequest.current;
      setHistoryError(false);
      setLoadingMore(false);
      activeConvRef.current = { kind: "group", conversationId };
      setActiveConv(activeConvRef.current);
      setMessages([]);
      setPendings([]);
      setHasMore(false);
      setLoadingHistory(true);
      try {
        const data = await localChatFetch<{ messages: ChatMessageItem[]; hasMore: boolean }>(
          `/groups/${conversationId}/messages`
        );
        if (request !== historyRequest.current) return;
        setMessages(prev => [...new Map([...data.messages, ...prev].map(m => [m.id, m])).values()].sort((a, b) => a.id - b.id));
        setHasMore(data.hasMore);
      } catch (e) {
        if (request !== historyRequest.current) return;
        setHistoryError(true);
        console.error("[chat] 群历史消息加载失败:", e);
        return;
      } finally {
        if (request === historyRequest.current) setLoadingHistory(false);
      }
      setConversations((prev) =>
        prev.map((c) => (c.type === "group" && c.conversationId === conversationId ? { ...c, unread: 0 } : c))
      );
      markGroupRead(conversationId);
    },
    [markGroupRead]
  );

  const loadMore = useCallback(async () => {
    const conv = activeConvRef.current;
    if (conv == null || loadingMore) return;
    const first = messagesRef.current[0];
    if (!first) return;
    const request = historyRequest.current;
    setLoadingMore(true);
    try {
      const path =
        conv.kind === "single"
          ? `/messages?peerId=${conv.peerId}&beforeId=${first.id}`
          : `/groups/${conv.conversationId}/messages?beforeId=${first.id}`;
      const data = await localChatFetch<{ messages: ChatMessageItem[]; hasMore: boolean }>(path);
      if (request !== historyRequest.current) return;
      // 按 id 去重后前插（保持 id 升序）
      setMessages((prev) => {
        const seen = new Set(prev.map((m) => m.id));
        return [...data.messages.filter((m) => !seen.has(m.id)), ...prev];
      });
      setHasMore(data.hasMore);
    } catch (e) {
      notify("加载历史消息失败，请重试");
      console.error("[chat] 加载更多失败:", e);
    } finally {
      if (request === historyRequest.current) setLoadingMore(false);
    }
  }, [loadingMore, notify]);

  // ---------- 消息合并 ----------

  const replacePending = useCallback((msg: ChatMessageItem, clientId?: string) => {
    setPendings((prev) => (clientId ? prev.filter((p) => p.clientId !== clientId) : prev));
    setMessages((prev) => {
      if (prev.some((m) => m.id === msg.id)) return prev;
      return [...prev, msg].sort((a, b) => a.id - b.id);
    });
  }, []);

  const mergeIncoming = useCallback((msg: ChatMessageItem) => {
    setMessages((prev) => {
      if (prev.some((m) => m.id === msg.id)) return prev;
      return [...prev, msg].sort((a, b) => a.id - b.id);
    });
  }, []);

  /** 单聊会话列表内联更新：置顶 + 刷新摘要 + （收消息时）未读 +1；新会话则全量刷新 */
  const upsertConversation = useCallback(
    (
      peerId: number,
      preview: string,
      createdAt: string,
      senderId: number,
      messageId: number,
      isMine: boolean
    ) => {
      setConversations((prev) => {
        const idx = prev.findIndex((c) => c.type === "single" && c.peer?.id === peerId);
        if (idx === -1) {
          void loadConversations();
          return prev;
        }
        const next = [...prev];
        const conv = { ...next[idx] };
        conv.lastMessage = { id: messageId, preview, senderId, createdAt };
        conv.lastMessageAt = createdAt;
        const active = activeConvRef.current;
        if (active?.kind === "single" && active.peerId === peerId) conv.unread = 0;
        else if (!isMine) conv.unread += 1;
        next.splice(idx, 1);
        next.unshift(conv);
        return next;
      });
    },
    [loadConversations]
  );

  /** v2：群会话列表内联更新（摘要带发言人昵称，前端拼「我:/昵称:」前缀展示） */
  const upsertGroupConversation = useCallback(
    (
      conversationId: number,
      preview: string,
      createdAt: string,
      senderId: number,
      senderName: string,
      messageId: number,
      isMine: boolean
    ) => {
      setConversations((prev) => {
        const idx = prev.findIndex((c) => c.type === "group" && c.conversationId === conversationId);
        if (idx === -1) {
          void loadConversations();
          return prev;
        }
        const next = [...prev];
        const conv = { ...next[idx] };
        conv.lastMessage = { id: messageId, preview, senderId, senderName, createdAt };
        conv.lastMessageAt = createdAt;
        const active = activeConvRef.current;
        if (active?.kind === "group" && active.conversationId === conversationId) conv.unread = 0;
        else if (!isMine) conv.unread += 1;
        next.splice(idx, 1);
        next.unshift(conv);
        return next;
      });
    },
    [loadConversations]
  );

  // ---------- 发送 ----------

  const sendMessage = useCallback(
    (raw: string) => {
      const conv = activeConvRef.current;
      const content = sanitizeContent(raw);
      if (conv == null || content == null) return;
      const origin = activeConvRef.current;
      const accept = (msg: ChatMessageItem) => {
        if (activeConvRef.current === origin) replacePending(msg, clientId);
        void loadConversations();
      };
      const restoreDraft = () => {
        const key = conv.kind === "single" ? `single-${conv.peerId}` : `group-${conv.conversationId}`;
        setDrafts(prev => ({ ...prev, [key]: prev[key] ? `${prev[key]}\n${content}` : content }));
      };
      const clientId = newClientId();
      setPendings((prev) => [...prev, { clientId, content }]);
      if (conv.kind === "single") {
        // 单聊：WS to 寻址（主路径）；WS 未连接 HTTP 兜底
        const sent = wsRef.current?.send(conv.peerId, content, clientId) ?? false;
        if (!sent) {
          void chatApiFetch<ChatMessageItem>("/messages", {
            method: "POST",
            body: JSON.stringify({ toUserId: conv.peerId, content, clientId }),
          })
            .then(accept)
            .catch((e) => {
              setPendings((prev) => prev.filter((p) => p.clientId !== clientId));
              restoreDraft();
              notify(e instanceof Error ? e.message : "发送失败，内容已恢复到草稿");
            });
        }
        return;
      }
      // 群聊：WS conversationId 寻址（主路径）；WS 未连接走群 HTTP 兜底
      const sent = wsRef.current?.sendFrame({ conversationId: conv.conversationId, content, clientId }) ?? false;
      if (!sent) {
        void chatApiFetch<ChatMessageItem>(CHAT_GROUP_API.messages(conv.conversationId), {
          method: "POST",
          body: JSON.stringify({ content, clientId }),
        })
          .then(accept)
          .catch((e) => {
            setPendings((prev) => prev.filter((p) => p.clientId !== clientId));
            restoreDraft();
              notify(e instanceof Error ? e.message : "发送失败，内容已恢复到草稿");
          });
      }
    },
    [notify, replacePending, loadConversations]
  );

  // ---------- WebSocket（帧协议与后端 ChatWebSocketHandler 一致） ----------

  const { status, send, sendFrame, markRead: wsMarkRead } = useChatWebSocket({
    onHello: () => {
      // 全量同步：会话列表（含未读）+ 在线状态；当前会话按 afterId 增量补拉
      void loadConversations();
      void loadContacts();
      const conv = activeConvRef.current;
      if (conv == null) return;
      const maxId = messagesRef.current.reduce((acc, m) => (m.id > acc ? m.id : acc), 0);
      if (maxId > 0) {
        const path =
          conv.kind === "single"
            ? `/messages?peerId=${conv.peerId}&afterId=${maxId}`
            : `/groups/${conv.conversationId}/messages?afterId=${maxId}`;
        void localChatFetch<{ messages: ChatMessageItem[]; hasMore: boolean }>(path)
          .then((data) =>
            activeConvRef.current !== conv ? undefined : setMessages((prev) => {
              const seen = new Set(prev.map((m) => m.id));
              return [...prev, ...data.messages.filter((m) => !seen.has(m.id))].sort((a, b) => a.id - b.id);
            })
          )
          .catch((e) => console.error("[chat] 断线补拉失败:", e));
      }
      if (conv.kind === "single") {
        markReadSingle(conv.peerId);
      } else {
        markGroupRead(conv.conversationId);
      }
    },
    onChat: (frame) => {
      // v2 兼容分支：一律以 conversationType ?? "single" 判定，群帧不得依赖 to 字段
      const convType = frame.conversationType ?? "single";
      if (convType === "group") {
        const isMine = frame.from === meId;
        const msg: ChatMessageItem = {
          id: frame.messageId,
          conversationId: frame.conversationId,
          senderId: frame.from,
          senderName: frame.fromName,
          content: frame.content,
          createdAt: frame.createdAt,
        };
        const conv = activeConvRef.current;
        const isActiveGroup = conv?.kind === "group" && conv.conversationId === frame.conversationId;
        if (isMine) {
          // 自己的 ack / 多端回显：按 clientId 替换乐观气泡（仅当前群匹配时入流）
          if (isActiveGroup) replacePending(msg, frame.clientId);
          else setPendings((prev) => prev.filter((p) => p.clientId !== frame.clientId));
        } else if (isActiveGroup) {
          // 群消息且会话已打开 → 直接入流（未读由 REST 落游标 + 列表内联修正）
          mergeIncoming(msg);
          markGroupRead(frame.conversationId);
        }
        upsertGroupConversation(
          frame.conversationId,
          frame.content,
          frame.createdAt,
          frame.from,
          frame.fromName,
          frame.messageId,
          isMine
        );
        return;
      }
      // ---- v1 单聊路径（原样保留） ----
      if (frame.from === meId) {
        // 自己的 ack / 多端回显：按 clientId 替换乐观气泡
        if (activeConvRef.current?.kind === "single" && activeConvRef.current.peerId === frame.to) replacePending(
          {
            id: frame.messageId,
            conversationId: frame.conversationId,
            senderId: frame.from,
            content: frame.content,
            createdAt: frame.createdAt,
          },
          frame.clientId
        );
        upsertConversation(frame.to ?? -1, frame.content, frame.createdAt, frame.from, frame.messageId, true);
        return;
      }
      // 对方消息：会话已打开 → 直接入流并标已读；未打开 → 仅累计未读
      if (activeConvRef.current?.kind === "single" && activeConvRef.current.peerId === frame.from) {
        mergeIncoming({
          id: frame.messageId,
          conversationId: frame.conversationId,
          senderId: frame.from,
          content: frame.content,
          createdAt: frame.createdAt,
        });
        markReadSingle(frame.from);
      }
      upsertConversation(frame.from, frame.content, frame.createdAt, frame.from, frame.messageId, false);
    },
    onNewConversation: () => {
      // v2：群创建广播 → 统一全量刷新（简单且天然覆盖排序/成员数）
      void loadConversations();
    },
    onOnline: (frame) => {
      setContacts((prev) =>
        prev.map((c) =>
          c.id === frame.userId
            ? { ...c, online: frame.online, lastOnlineAt: frame.online ? null : c.lastOnlineAt }
            : c
        )
      );
      setConversations((prev) =>
        prev.map((c) =>
          c.type === "single" && c.peer?.id === frame.userId
            ? { ...c, peer: { ...c.peer, online: frame.online } }
            : c
        )
      );
    },
    onError: (frame) => {
      notify(frame.message || "操作失败");
    },
  });

  // 渲染期把 hook 返回的最新实现同步进桥接 ref（此后所有回调均经 wsRef 调用）
  wsRef.current = { send, sendFrame, markRead: wsMarkRead };

  // 初始化：会话 + 联系人
  useEffect(() => {
    void loadConversations();
    void loadContacts();
  }, [loadConversations, loadContacts]);

  // ---------- 派生数据 ----------

  const activeHeader = useMemo<ActiveHeader | null>(() => {
    const conv = activeConv;
    if (conv == null) return null;
    if (conv.kind === "group") {
      const g = conversations.find((c) => c.type === "group" && c.conversationId === conv.conversationId)?.group;
      return {
        kind: "group",
        conversationId: conv.conversationId,
        name: g?.name || "群聊",
        memberCount: g?.memberCount ?? 0,
      };
    }
    const singleConv = conversations.find((c) => c.type === "single" && c.peer?.id === conv.peerId);
    if (singleConv?.peer) {
      return {
        kind: "single",
        peer: {
          id: singleConv.peer.id,
          username: singleConv.peer.username,
          displayName: singleConv.peer.displayName,
          online: singleConv.peer.online,
        },
      };
    }
    const contact = contacts.find((c) => c.id === conv.peerId);
    if (contact) {
      return {
        kind: "single",
        peer: {
          id: contact.id,
          username: contact.username,
          displayName: contact.displayName || contact.username,
          online: contact.online,
        },
      };
    }
    return null;
  }, [activeConv, conversations, contacts]);

  const displayMessages = useMemo<ChatDisplayMessage[]>(
    () => [
      ...messages,
      ...pendings.map((p) => ({
        id: -1,
        conversationId: 0,
        senderId: meId,
        content: p.content,
        createdAt: "",
        pending: true,
        clientId: p.clientId,
      })),
    ],
    [messages, pendings, meId]
  );

  // ---------- 渲染 ----------

  const onlinePanel = (
    <OnlinePanel
      contacts={contacts}
      activePeer={activeHeader?.kind === "single" ? activeHeader.peer : null}
      onOpenSingle={(p) => {
        setOnlinePanelOpen(false);
        void openSingle(p);
      }}
      onCreateGroup={() => {
        setOnlinePanelOpen(false);
        setCreateGroupOpen(true);
      }}
    />
  );

  return (
    <section className="chat-workspace" aria-label="聊天会话">
      <header className="chat-page-header">
        <div><h1>聊天会话</h1><p>与团队保持沟通，让协作在会话中继续。</p></div>
        <div className="chat-page-actions">
          <Button icon={<TeamOutlined />} onClick={() => setOnlinePanelOpen(true)}>联系人</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateGroupOpen(true)}>发起会话</Button>
        </div>
      </header>
      {listError && <Alert type="error" title="会话列表加载失败" action={<Button size="small" onClick={() => void loadConversations()}>重试</Button>} />}
      <div className={`chat-layout ${activeConv ? "chat-has-active" : ""}`}>
      <aside className="chat-conversations">
        <ConversationList
          conversations={conversations}
          contacts={contacts}
          meId={meId}
          activeConv={activeConv}
          loading={loadingList}
          onSelectPeer={(p) => void openSingle(p)}
          onSelectGroup={(id) => void openGroup(id)}
          onDeleteConversations={(ids) => void handleDeleteConversations(ids)}
        />
      </aside>
      <div className="chat-main">
      <MessagePanel
        key={activeKey}
        draft={drafts[activeKey] || ""}
        onDraftChange={value => setDrafts(prev => ({ ...prev, [activeKey]: value }))}
        historyError={historyError}
        onRetry={() => { if (activeHeader?.kind === "single") void openSingle(activeHeader.peer); else if (activeHeader?.kind === "group") void openGroup(activeHeader.conversationId); }}
        onBack={() => { ++historyRequest.current; activeConvRef.current = null; setActiveConv(null); }}
        onStart={() => setCreateGroupOpen(true)}
        meId={meId}
        meName={meName}
        active={activeHeader}
        messages={displayMessages}
        loadingHistory={loadingHistory}
        loadingMore={loadingMore}
        hasMore={hasMore}
        status={status}
        onLoadMore={() => void loadMore()}
        onSend={sendMessage}
      />
      </div>
      </div>
      <Drawer open={onlinePanelOpen} onClose={() => setOnlinePanelOpen(false)} placement="right" size={320} title="团队联系人" styles={{ body: { padding: 0 } }}>
        {contactsError && <Alert type="error" title="联系人加载失败" action={<Button onClick={() => void loadContacts()}>重试</Button>} />}
        {onlinePanel}
      </Drawer>
      <CreateGroupModal
        loadError={contactsError}
        onRetry={() => void loadContacts()}
        open={createGroupOpen}
        contacts={contacts}
        onClose={() => setCreateGroupOpen(false)}
        onOpenSingle={(p) => void openSingle(p)}
        onCreated={(conversationId) => {
          // 本地刷新会话列表并切到新群（new_conversation 帧兜底刷新，双保险无害）
          void loadConversations();
          void openGroup(conversationId);
        }}
      />
    </section>
  );
}
