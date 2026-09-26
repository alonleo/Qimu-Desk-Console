"use client";

import { useEffect, useRef, useState } from "react";
import { Alert, Avatar, Badge, Button, Input, Popover, Spin, Tag, Tooltip } from "antd";
import { ArrowLeftOutlined, MessageOutlined, SendOutlined, SmileOutlined, TeamOutlined } from "@ant-design/icons";
import { moduleGradient } from "../modules";
import type { ChatDisplayMessage, WsStatus } from "@/core/chat";
import { CONTENT_MAX, formatMessageTime } from "@/core/chat";

/**
 * 消息区（chat-module）：气泡流（向上滚动分页）+ 输入区（Enter 发送 / Shift+Enter 换行 + emoji 面板）。
 * v2：头部按会话类型显示「昵称」或「群名 · N人」；群聊左侧气泡显示发送者昵称（REST senderName / WS fromName）。
 * 安全铁律：消息内容一律作为 React 文本节点渲染（自动转义），禁止 dangerouslySetInnerHTML。
 */

// 快捷 emoji（utf8mb4 原生存储，无需特殊处理）
const EMOJIS = [
  "😀", "😄", "😂", "🤣", "😊", "😍", "😘", "😜", "🤔", "😎",
  "🙌", "👍", "👏", "🙏", "💪", "🔥", "🎉", "❤️", "🌹", "☕",
  "🍺", "⚽", "🚀", "💯", "✅", "❌", "⚠️", "👋", "😢", "😭",
];

export type ActivePeer = {
  id: number;
  username: string;
  displayName: string;
  online: boolean;
};

/** v2：消息区头部双态（单聊对端 / 群信息） */
export type ActiveHeader =
  | { kind: "single"; peer: ActivePeer }
  | { kind: "group"; conversationId: number; name: string; memberCount: number };

type Props = {
  draft: string;
  onDraftChange: (value: string) => void;
  historyError: boolean;
  onRetry: () => void;
  onBack: () => void;
  onStart: () => void;
  meName: string;
  meId: number;
  active: ActiveHeader | null;
  messages: ChatDisplayMessage[];
  loadingHistory: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  status: WsStatus;
  onLoadMore: () => void;
  onSend: (content: string) => void;
};

function DayDivider({ date }: { date: string }) {
  return (
    <div className="my-3 flex items-center justify-center">
      <span className="rounded bg-[#f0f0f0] px-2 py-0.5 text-[11px] text-[#8c8c8c]">{date}</span>
    </div>
  );
}

export default function MessagePanel({
  draft: text, onDraftChange: setText, historyError, onRetry, onBack, onStart,
  meId, meName,
  active,
  messages,
  loadingHistory,
  loadingMore,
  hasMore,
  status,
  onLoadMore,
  onSend,
}: Props) {
  const [emojiOpen, setEmojiOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const previousHeight = useRef<number | null>(null);
  const nearBottom = useRef(true);
  const lastMessage = useRef<string | number | undefined>(undefined);
  const isGroup = active?.kind === "group";
  const inputOk = !loadingHistory && !historyError && text.trim().length > 0 && text.trim().length <= CONTENT_MAX;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const last = messages.at(-1);
    const key = last?.clientId ?? last?.id;
    if (previousHeight.current !== null && !loadingMore) {
      el.scrollTop += el.scrollHeight - previousHeight.current;
      previousHeight.current = null;
    } else if (nearBottom.current || (key !== lastMessage.current && last?.senderId === meId)) {
      el.scrollTop = el.scrollHeight;
    }
    lastMessage.current = key;
  }, [messages, loadingMore, loadingHistory, meId]);

  function loadEarlier() {
    if (!loadingMore && !loadingHistory && hasMore) {
      previousHeight.current = scrollRef.current?.scrollHeight ?? null;
      onLoadMore();
    }
  }
  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
  }

  function doSend() {
    if (!inputOk) return;
    onSend(text);
    setText("");
    setEmojiOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      doSend();
    }
  }

  if (!active) {
    return (
      <div className="chat-empty">
        <div className="chat-empty-icon"><MessageOutlined /></div>
        <h2>从一段会话开始协作</h2>
        <p>选择左侧会话继续交流，或邀请同事发起单聊、群聊。</p>
        <Button type="primary" onClick={onStart}>发起会话</Button>
      </div>
    );
  }

  const statusTag =
    status === "open" ? (
      <Tag color="success" style={{ marginInlineEnd: 0, fontSize: 11, lineHeight: "18px" }}>
        已连接
      </Tag>
    ) : status === "connecting" ? (
      <Tag color="processing" style={{ marginInlineEnd: 0, fontSize: 11, lineHeight: "18px" }}>
        连接中…
      </Tag>
    ) : (
      <Tag color="warning" style={{ marginInlineEnd: 0, fontSize: 11, lineHeight: "18px" }}>
        重连中
      </Tag>
    );

  // 日期分隔：相邻消息跨天时插入；群聊气泡上方带发送者昵称
  const items: React.ReactNode[] = [];
  let lastDate = "";
  let lastGroupSenderName = "";
  messages.forEach((m) => {
    const date = (m.createdAt || "").split(/[T ]/)[0] || "";
    if (date && date !== lastDate) {
      items.push(<DayDivider key={`d-${m.id}-${date}`} date={date} />);
      lastDate = date;
      lastGroupSenderName = "";
    }
    const mine = m.senderId === meId;
    const senderName = m.senderName || "";
    // 群聊：同发送者连续消息不重复显示昵称（切日/切人后重置）
    const showNickname = isGroup && !mine && senderName !== "" && senderName !== lastGroupSenderName;
    lastGroupSenderName = isGroup && !mine ? senderName : "";
    const bubble = (
      <div
        title={m.pending ? "发送中" : formatMessageTime(m.createdAt)}
        className={`max-w-[78%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed break-words whitespace-pre-wrap ${
          mine
            ? m.pending
              ? "bg-[#8199b3] text-white/90"
              : "bg-[#345d88] text-white"
            : "bg-white text-[#262626] shadow-sm"
        }`}
      >
        {/* 纯文本节点渲染（React 自动转义，防 XSS） */}
        {m.content}
        <span className={`mt-1 block text-[10px] ${mine ? "text-white/70" : "text-[#8c8c8c]"}`}>{m.pending ? "发送中…" : formatMessageTime(m.createdAt)}</span>
      </div>
    );
    items.push(
      <div
        key={m.clientId ?? m.id}
        className={`flex items-end gap-2 ${mine ? "justify-end" : "justify-start"}`}
      >
        {mine ? (
          <>
            {m.pending && (
              <Spin size="small" style={{ marginInlineEnd: 2 }} />
            )}
            {bubble}
            <Avatar size={30} style={{ background: moduleGradient("#61778e"), fontSize: 13, flexShrink: 0 }}>
              {meName.slice(0, 1)}
            </Avatar>
          </>
        ) : (
          <>
            <Avatar size={30} style={{ background: moduleGradient("#345d88"), fontSize: 13, flexShrink: 0 }}>
              {(isGroup ? senderName : active.kind === "single" ? active.peer.displayName || active.peer.username : "")
                .slice(0, 1)
                .toUpperCase() || "?"}
            </Avatar>
            {bubble}
          </>
        )}
      </div>
    );
    if (showNickname) {
      // 昵称行插到该气泡行上方（左对齐，与气泡缩进一致）
      const row = items[items.length - 1];
      items[items.length - 1] = (
        <div key={`g-${m.clientId ?? m.id}`} className="space-y-0.5">
          <div className="pl-10 text-[11px] text-[#8c8c8c]">{senderName}</div>
          {row}
        </div>
      );
    }
  });

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-[#f5f6fa]">
      {/* 会话头 */}
      <div className="flex shrink-0 items-center justify-between border-b border-[#f0f0f0] bg-white px-4 py-2.5">
        <Button className="chat-back" type="text" aria-label="返回会话列表" icon={<ArrowLeftOutlined />} onClick={onBack} />
        {active.kind === "single" ? (
          <div className="flex min-w-0 items-center gap-2.5">
            <Badge dot color={active.peer.online ? "#52c41a" : "#d9d9d9"} offset={[-2, 34]}>
              <Avatar size={36} style={{ background: moduleGradient("#345d88") }}>
                {(active.peer.displayName || active.peer.username).slice(0, 1).toUpperCase()}
              </Avatar>
            </Badge>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-[#262626]">
                {active.peer.displayName || active.peer.username}
              </div>
              <div className="text-[11px] text-[#8c8c8c]">
                {active.peer.online ? "在线" : "离线"} · @{active.peer.username}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex min-w-0 items-center gap-2.5">
            <Avatar size={36} icon={<TeamOutlined />} style={{ background: moduleGradient("#61778e") }} />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-[#262626]">{active.name}</div>
              <div className="text-[11px] text-[#8c8c8c]">群聊 · {active.memberCount}人</div>
            </div>
          </div>
        )}
        <Tooltip title="实时通道状态">{statusTag}</Tooltip>
      </div>

      {historyError && <Alert type="error" title="聊天记录加载失败" action={<Button size="small" onClick={onRetry}>重试</Button>} />}
      {/* 气泡流 */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4"
      >
        {loadingHistory ? (
          <div className="flex justify-center py-8">
            <Spin />
          </div>
        ) : (
          <>
            {hasMore && <div className="text-center"><Button type="text" size="small" loading={loadingMore} onClick={loadEarlier}>加载更早的消息</Button></div>}
            {loadingMore && (
              <div className="flex justify-center py-1">
                <Spin size="small" />
              </div>
            )}
            {messages.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-[#bfbfbf]">
                {isGroup ? "还没有群消息，说点什么吧 👋" : "还没有消息，打个招呼吧 👋"}
              </div>
            ) : (
              items
            )}
          </>
        )}
      </div>

      {/* 输入区 */}
      <div className="shrink-0 border-t border-[#f0f0f0] bg-white p-3">
        <div className="mb-2 flex items-center justify-between">
          <Popover
            open={emojiOpen}
            onOpenChange={setEmojiOpen}
            trigger={["click"]}
            placement="topLeft"
            content={
              <div className="grid w-64 grid-cols-8 gap-1">
                {EMOJIS.map((e) => (
                  <button
                    key={e}
                    type="button"
                    className="cursor-pointer rounded p-1 text-lg hover:bg-[#f0f0f0]"
                    onClick={() => setText((text + e).slice(0, CONTENT_MAX))}
                  >
                    {e}
                  </button>
                ))}
              </div>
            }
          >
            <Button type="text" size="small" icon={<SmileOutlined />} title="表情" />
          </Popover>
          <span className="text-[11px] text-[#bfbfbf]">
            {text.length > CONTENT_MAX - 100 ? `${text.length}/${CONTENT_MAX}` : "Enter 发送 / Shift+Enter 换行"}
          </span>
        </div>
        <div className="flex items-end gap-2">
          <Input.TextArea
            aria-label="聊天消息"
            disabled={loadingHistory || historyError}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={isGroup ? "输入群消息…" : "输入消息…"}
            autoSize={{ minRows: 2, maxRows: 5 }}
            maxLength={CONTENT_MAX}
            style={{ resize: "none" }}
          />
          <Button
            type="primary"
            icon={<SendOutlined />}
            disabled={!inputOk}
            onClick={doSend}
          >
            发送
          </Button>
        </div>
      </div>
    </div>
  );
}
