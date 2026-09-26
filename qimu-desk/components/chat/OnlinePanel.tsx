"use client";

import { useMemo, useState } from "react";
import { Avatar, Badge, Button, Empty, Input, Tag } from "antd";
import { PlusOutlined, SearchOutlined } from "@ant-design/icons";
import { moduleGradient } from "../modules";
import type { ChatContact } from "@/core/chat";
import type { SelectablePeer } from "./ConversationList";

/**
 * 在线用户面板（chat-module v2，PRD §五-1 方案 A：右栏常驻）：
 * 标题「在线 (n)」+ 搜索框 + 「发起群聊」按钮 + 在线用户列表。
 * - 数据源复用 contacts（后端 /contacts + hello/online 帧驱动），零新增请求；
 * - 仅展示在线用户（离线用户仍通过左栏搜索发起会话）；
 * - 点击条目 = 以 to 寻址开单聊（复用 v1 openConversation 逻辑）；
 * - 单聊打开时底部追加对方资料卡（仅展示）；
 * - <1280px 时由父级折叠为悬浮按钮 + Drawer（本组件作为 Drawer 内容复用）。
 */

type ActivePeerCard = {
  id: number;
  username: string;
  displayName: string;
  online: boolean;
};

type Props = {
  contacts: ChatContact[];
  /** 当前打开的单聊对端（展示资料卡；群会话/无会话时不展示） */
  activePeer: ActivePeerCard | null;
  onOpenSingle: (peer: SelectablePeer) => void;
  onCreateGroup: () => void;
};

export default function OnlinePanel({ contacts, activePeer, onOpenSingle, onCreateGroup }: Props) {
  const [search, setSearch] = useState("");

  const onlineContacts = useMemo(() => contacts.filter((c) => c.online), [contacts]);

  const kw = search.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      kw
        ? onlineContacts.filter((c) => {
            const name = (c.displayName || c.username).toLowerCase();
            return name.includes(kw) || c.username.toLowerCase().includes(kw);
          })
        : onlineContacts,
    [onlineContacts, kw]
  );

  return (
    <div className="flex h-full flex-col bg-white">
      {/* 标题 + 建群入口 */}
      <div className="shrink-0 px-3 pb-2 pt-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-semibold text-[#262626]">在线 ({onlineContacts.length})</span>
          <Button
            size="small"
            type="primary"
            icon={<PlusOutlined />}
            style={{ background: "#0ea5e9" }}
            onClick={onCreateGroup}
          >
            发起群聊
          </Button>
        </div>
        <Input
          allowClear
          size="small"
          prefix={<SearchOutlined style={{ color: "#bfbfbf" }} />}
          placeholder="搜索在线用户"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* 在线用户列表 */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="py-8">
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={kw ? "没有匹配的在线用户" : "暂无在线用户"}
            />
          </div>
        ) : (
          filtered.map((u) => {
            const name = u.displayName || u.username;
            return (
              <div
                key={u.id}
                onClick={() => onOpenSingle({ id: u.id, username: u.username, displayName: name, online: true })}
                className="flex cursor-pointer items-center gap-2.5 px-3 py-2 hover:bg-[#fafafa]"
              >
                <Avatar size={32} style={{ background: moduleGradient("#0ea5e9"), fontSize: 13 }}>
                  {name.slice(0, 1).toUpperCase()}
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-[#262626]">{name}</div>
                  <div className="truncate text-[11px] text-[#8c8c8c]">@{u.username}</div>
                </div>
                <Badge dot color="#52c41a" offset={[-2, 2]} />
              </div>
            );
          })
        )}
      </div>

      {/* 单聊打开时的对方资料卡（仅展示，PRD §五-1 顺手项） */}
      {activePeer && (
        <div className="shrink-0 border-t border-[#f0f0f0] p-3">
          <div className="mb-2 text-[11px] text-[#bfbfbf]">当前会话</div>
          <div className="flex items-center gap-2.5">
            <Badge dot color={activePeer.online ? "#52c41a" : "#d9d9d9"} offset={[-2, 30]}>
              <Avatar size={36} style={{ background: moduleGradient("#0ea5e9") }}>
                {(activePeer.displayName || activePeer.username).slice(0, 1).toUpperCase()}
              </Avatar>
            </Badge>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-[#262626]">
                {activePeer.displayName || activePeer.username}
              </div>
              <div className="truncate text-[11px] text-[#8c8c8c]">@{activePeer.username}</div>
            </div>
          </div>
          <div className="mt-2">
            <Tag
              color={activePeer.online ? "success" : "default"}
              style={{ marginInlineEnd: 0, fontSize: 11, lineHeight: "18px" }}
            >
              {activePeer.online ? "在线" : "离线"}
            </Tag>
          </div>
        </div>
      )}
    </div>
  );
}
