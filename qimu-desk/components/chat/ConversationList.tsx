"use client";

import { useMemo, useState } from "react";
import { App, Avatar, Badge, Button, Checkbox, Empty, Input, Popconfirm, Segmented, Spin } from "antd";
import { CheckSquareOutlined, DeleteOutlined, SearchOutlined, TeamOutlined } from "@ant-design/icons";
import { moduleGradient } from "../modules";
import type { ChatActiveConv, ChatContact, ChatConversationItem } from "@/core/chat";
import { formatMessageTime } from "@/core/chat";

/**
 * 会话列表（chat-module）：最近会话（含未读角标）+ 搜索发起新会话。
 * v2：群会话项 = 群图标（TeamOutlined 主色底）+ 群名 · N人 + 「发言人: 摘要」（自己发的显示「我:」）；
 * 空搜索：展示会话列表；有搜索词：过滤会话并列出可发起会话的联系人。
 * v3：删除会话（hover 显示删除按钮，Popconfirm 二次确认）+ 批量管理（Checkbox 多选 + 顶部操作条）。
 * 删除语义为微信式「仅从我的列表移除」：不删消息、不影响对方，对方来新消息时会话自动恢复。
 */

export type SelectablePeer = {
  id: number;
  username: string;
  displayName: string;
  online: boolean;
};

type Props = {
  conversations: ChatConversationItem[];
  contacts: ChatContact[];
  meId: number;
  activeConv: ChatActiveConv | null;
  loading?: boolean;
  onSelectPeer: (peer: SelectablePeer) => void;
  onSelectGroup: (conversationId: number) => void;
  /** v3：删除会话（单个或批量），由父组件发后端请求并刷新列表状态 */
  onDeleteConversations: (ids: number[]) => void;
};

function PeerAvatar({ name, online, size = 40 }: { name: string; online: boolean; size?: number }) {
  const initial = (name || "?").slice(0, 1).toUpperCase();
  return (
    <Badge dot color={online ? "#52c41a" : "#d9d9d9"} offset={[-2, size - 4]}>
      <Avatar size={size} style={{ background: moduleGradient("#345d88"), fontSize: size * 0.4 }}>
        {initial}
      </Avatar>
    </Badge>
  );
}

/** 群会话图标（与用户首字头像明确区分：统一 icon + 主色底） */
function GroupAvatar({ size = 40 }: { size?: number }) {
  return (
    <Avatar size={size} icon={<TeamOutlined />} style={{ background: moduleGradient("#61778e"), fontSize: size * 0.45 }} />
  );
}

/** 群摘要前缀：自己发的「我」，他人为发言人昵称（preview 存纯内容，前缀前端拼） */
function groupSummaryPrefix(meId: number, senderId: number, senderName?: string): string {
  return senderId === meId ? "我" : senderName || "";
}

export default function ConversationList({
  conversations,
  contacts,
  meId,
  activeConv,
  loading,
  onSelectPeer,
  onSelectGroup,
  onDeleteConversations,
}: Props) {
  const { modal } = App.useApp();
  const [search, setSearch] = useState("");
  // v3：批量管理状态（进入批量模式：点击会话 = 切换选中；退出恢复打开会话）
  const [batchMode, setBatchMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const [filter, setFilter] = useState("全部");
  const kw = search.trim().toLowerCase();

  const filteredConvs = useMemo(
    () =>
      (kw
        ? conversations.filter((c) => {
            if (c.type === "group") {
              return (c.group?.name || "").toLowerCase().includes(kw);
            }
            const name = (c.peer?.displayName || c.peer?.username || "").toLowerCase();
            const username = (c.peer?.username || "").toLowerCase();
            return name.includes(kw) || username.includes(kw);
          })
        : conversations).filter(c => filter === "全部" || (filter === "未读" ? c.unread > 0 : c.type === "group")),
    [conversations, kw, filter]
  );

  // 搜索时供发起新会话的联系人（排除已在会话列表中且命中的重复项由界面自然合并）
  const filteredContacts = useMemo(
    () =>
      kw
        ? contacts.filter((c) => {
            const name = (c.displayName || c.username).toLowerCase();
            return !conversations.some(conv => conv.type === "single" && conv.peer?.id === c.id) && (name.includes(kw) || c.username.toLowerCase().includes(kw));
          })
        : [],
    [contacts, kw, conversations]
  );

  /** 切换批量模式：退出时清空选中集合 */
  const toggleBatchMode = () => {
    setBatchMode((prev) => {
      if (prev) setSelectedIds(new Set());
      return !prev;
    });
  };

  /** 切换某会话的选中态 */
  const toggleSelected = (conversationId: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(conversationId)) {
        next.delete(conversationId);
      } else {
        next.add(conversationId);
      }
      return next;
    });
  };

  /** 批量删除二次确认：确认后交由父组件发请求，并退出批量模式 */
  const confirmDeleteSelected = () => {
    if (selectedIds.size === 0) return;
    const ids = [...selectedIds];
    modal.confirm({
      title: `删除所选 ${ids.length} 个会话？`,
      content: "仅从你的列表移除，对方不受影响",
      okText: "删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: () => {
        onDeleteConversations(ids);
        setBatchMode(false);
        setSelectedIds(new Set());
      },
    });
  };

  /** 会话项点击：批量模式 = 切换选中；普通模式 = 打开会话 */
  const onItemActivate = (c: ChatConversationItem) => {
    if (batchMode) {
      toggleSelected(c.conversationId);
      return;
    }
    if (c.type === "group") {
      onSelectGroup(c.conversationId);
      return;
    }
    onSelectPeer({
      id: c.peer?.id ?? 0,
      username: c.peer?.username || "",
      displayName: c.peer?.displayName || c.peer?.username || "",
      online: c.peer?.online ?? false,
    });
  };

  /** 行样式：批量模式选中态高亮；普通模式保留当前会话高亮 */
  const rowClass = (selected: boolean, active: boolean) =>
    `chat-conversation-row group flex cursor-pointer items-center gap-3 px-3 py-2.5 ${
      selected ? "bg-[#eaf0f7]" : active ? "bg-[#eaf0f7]" : "hover:bg-[#fafafa]"
    }`;

  /** v3：行首 Checkbox（仅批量模式；阻断冒泡避免触发行的切换选中） */
  const leadingCheckbox = (c: ChatConversationItem) =>
    batchMode ? (
      <span className="shrink-0" onClick={(e) => e.stopPropagation()}>
        <Checkbox checked={selectedIds.has(c.conversationId)} onChange={() => toggleSelected(c.conversationId)} />
      </span>
    ) : null;

  /** v3：行尾删除按钮（普通模式 hover 显示，Popconfirm 二次确认；阻断冒泡避免误打开会话） */
  const trailingDelete = (c: ChatConversationItem) =>
    batchMode ? null : (
      <span
        className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
        onClick={(e) => e.stopPropagation()}
      >
        <Popconfirm
          title="删除会话？"
          description="对方不受影响"
          okText="删除"
          okButtonProps={{ danger: true }}
          cancelText="取消"
          onConfirm={() => onDeleteConversations([c.conversationId])}
        >
          <Button aria-label="删除会话" size="small" type="text" icon={<DeleteOutlined style={{ color: "#8c8c8c" }} />} />
        </Popconfirm>
      </span>
    );

  return (
    <div className="flex h-full flex-col border-r border-[#f0f0f0] bg-white">
      <div className="shrink-0 p-3">
        <div className="chat-list-title"><strong>会话</strong><span>{conversations.length} 个会话</span></div>
        <div className="flex items-center gap-2">
          <Input
            allowClear
            prefix={<SearchOutlined style={{ color: "#bfbfbf" }} />}
            aria-label="搜索会话或联系人"
            placeholder="搜索会话或联系人"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {/* v3：批量管理入口（图标按钮，激活态主色） */}
          <Button
            type="text"
            aria-label="批量管理"
            icon={<CheckSquareOutlined style={{ color: batchMode ? "#61778e" : "#8c8c8c" }} />}
            onClick={toggleBatchMode}
          />
        </div>
        <Segmented block className="mt-3" options={["全部", "未读", "群聊"]} value={filter} onChange={setFilter} />
        {/* v3：批量模式顶部操作条 */}
        {batchMode && (
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-xs text-[#8c8c8c]">已选 {selectedIds.size} 项</span>
            <span className="flex items-center gap-2">
              <Button size="small" type="primary" danger disabled={selectedIds.size === 0} onClick={confirmDeleteSelected}>
                删除所选
              </Button>
              <Button size="small" onClick={toggleBatchMode}>
                取消
              </Button>
            </span>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex justify-center py-10">
            <Spin />
          </div>
        ) : filteredConvs.length === 0 && filteredContacts.length === 0 ? (
          <div className="py-10">
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={kw ? "没有匹配的会话或联系人" : filter === "未读" ? "所有会话都已读完" : filter === "群聊" ? "暂无群聊，点击发起会话创建" : "暂无会话，点击发起会话开始聊天"}
            />
          </div>
        ) : (
          <>
            {filteredConvs.map((c) => {
              const last = c.lastMessage;
              if (c.type === "group") {
                // 群会话项：群图标 + 群名 · N人 + 「发言人: 摘要」
                const groupName = c.group?.name || "群聊";
                const memberCount = c.group?.memberCount ?? 0;
                const active =
                  !batchMode && activeConv?.kind === "group" && activeConv.conversationId === c.conversationId;
                const prefix = last ? groupSummaryPrefix(meId, last.senderId, last.senderName) : "";
                return (
                  <div
                    key={c.conversationId}
                    role="button" tabIndex={0}
                  onKeyDown={e => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onItemActivate(c); } }}
                  onClick={() => onItemActivate(c)}
                    className={rowClass(batchMode && selectedIds.has(c.conversationId), active)}
                  >
                    {leadingCheckbox(c)}
                    <GroupAvatar />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-sm font-medium text-[#262626]">
                          {groupName}
                          <span className="ml-1 text-[11px] font-normal text-[#8c8c8c]">· {memberCount}人</span>
                        </span>
                        {last && (
                          <span className="shrink-0 text-[11px] text-[#bfbfbf]">
                            {formatMessageTime(last.createdAt)}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs text-[#8c8c8c]">
                          {last ? `${prefix ? `${prefix}: ` : ""}${last.preview || " "}` : "开始群聊吧"}
                        </span>
                        {c.unread > 0 && (
                          <Badge
                            count={c.unread > 99 ? "99+" : c.unread}
                            size="small"
                            color="#ff4d4f"
                            style={{ flexShrink: 0 }}
                          />
                        )}
                      </div>
                    </div>
                    {trailingDelete(c)}
                  </div>
                );
              }
              // 单聊项：v1 结构不变 + v3 删除/批量能力
              const name = c.peer?.displayName || c.peer?.username || "";
              const active = !batchMode && activeConv?.kind === "single" && activeConv.peerId === c.peer?.id;
              return (
                <div
                  key={c.conversationId}
                  role="button" tabIndex={0}
                  onKeyDown={e => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onItemActivate(c); } }}
                  onClick={() => onItemActivate(c)}
                  className={rowClass(batchMode && selectedIds.has(c.conversationId), active)}
                >
                  {leadingCheckbox(c)}
                  <PeerAvatar name={name} online={c.peer?.online ?? false} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm font-medium text-[#262626]">{name}</span>
                      {last && (
                        <span className="shrink-0 text-[11px] text-[#bfbfbf]">
                          {formatMessageTime(last.createdAt)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs text-[#8c8c8c]">
                        {last ? last.preview || " " : "开始聊天吧"}
                      </span>
                      {c.unread > 0 && (
                        <Badge
                          count={c.unread > 99 ? "99+" : c.unread}
                          size="small"
                          color="#ff4d4f"
                          style={{ flexShrink: 0 }}
                        />
                      )}
                    </div>
                  </div>
                  {trailingDelete(c)}
                </div>
              );
            })}

            {kw && filteredContacts.length > 0 && (
              <>
                <div className="flex items-center gap-1 px-3 pb-1 pt-3 text-[11px] text-[#bfbfbf]">
                  <TeamOutlined />
                  发起新会话
                </div>
                {filteredContacts.map((u) => {
                  const name = u.displayName || u.username;
                  const inConv = conversations.some((c) => c.type === "single" && c.peer?.id === u.id);
                  if (inConv) return null;
                  return (
                    <div
                      key={u.id}
                      role="button" tabIndex={0}
                      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelectPeer({ id: u.id, username: u.username, displayName: name, online: u.online }); } }}
                      onClick={() => onSelectPeer({ id: u.id, username: u.username, displayName: name, online: u.online })}
                      className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-[#fafafa]"
                    >
                      <PeerAvatar name={name} online={u.online} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-[#262626]">{name}</div>
                        <div className="truncate text-xs text-[#8c8c8c]">@{u.username}</div>
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
