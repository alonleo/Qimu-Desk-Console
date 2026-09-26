"use client";

import { useEffect, useMemo, useState } from "react";
import { Alert, App, Avatar, Button, Checkbox, Empty, Input, Modal } from "antd";
import { SearchOutlined, TeamOutlined } from "@ant-design/icons";
import { moduleGradient } from "../modules";
import type { ChatContact } from "@/core/chat";
import { CHAT_GROUP_API, GROUP_NAME_MAX, chatApiFetch, sanitizeGroupName } from "@/core/chat";
import type { SelectablePeer } from "./ConversationList";

/**
 * 建群弹窗（chat-module v2，PRD §五-2）：
 * - 选人范围 = 全部有效用户 contacts（不按在线过滤，允许拉离线用户入群）；
 * - 选中 1 人 → 按钮变「发单聊」，直接开单聊（退化为单聊）；
 * - 选中 ≥2 人 + 群名（1~30 字）→ POST /groups 建群，成功后由父级切换到新群会话；
 * - 创建者自动入群（后端处理），群成员上限 50（含创建者）。
 */

type Props = {
  loadError?: boolean;
  onRetry?: () => void;
  open: boolean;
  contacts: ChatContact[];
  /** 预选用户 id（从在线面板建群入口带入时可用；当前未使用预留） */
  preselectedIds?: number[];
  onClose: () => void;
  /** 选中 1 人：直接开单聊 */
  onOpenSingle: (peer: SelectablePeer) => void;
  /** 建群成功：父级刷新会话列表并切换到新群 */
  onCreated: (conversationId: number) => void;
};

export default function CreateGroupModal({
  open, loadError, onRetry,
  contacts,
  preselectedIds,
  onClose,
  onOpenSingle,
  onCreated,
}: Props) {
  const { message } = App.useApp();
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [groupName, setGroupName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // 打开时重置（预选态可从在线面板带入）
  useEffect(() => {
    if (open) {
      setSearch("");
      setSelectedIds(preselectedIds ? [...preselectedIds] : []);
      setGroupName("");
      setSubmitting(false);
    }
  }, [open, preselectedIds]);

  const kw = search.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      kw
        ? contacts.filter((c) => {
            const name = (c.displayName || c.username).toLowerCase();
            return name.includes(kw) || c.username.toLowerCase().includes(kw);
          })
        : contacts,
    [contacts, kw]
  );

  const selectedCount = selectedIds.length;

  /** 提交：1 人退化为单聊；≥2 人 + 群名建群 */
  function handleSubmit() {
    if (submitting) return;
    if (selectedCount === 1) {
      const u = contacts.find((c) => c.id === selectedIds[0]);
      if (u) {
        onOpenSingle({ id: u.id, username: u.username, displayName: u.displayName || u.username, online: u.online });
        onClose();
      }
      return;
    }
    const name = sanitizeGroupName(groupName);
    if (name == null) {
      message.warning(`群名须为 1~${GROUP_NAME_MAX} 字符`);
      return;
    }
    setSubmitting(true);
    void chatApiFetch<{ conversationId: number }>(CHAT_GROUP_API.create, {
      method: "POST",
      body: JSON.stringify({ name, memberIds: selectedIds }),
    })
      .then((data) => {
        onCreated(data.conversationId);
        onClose();
      })
      .catch((e) => {
        message.error(e instanceof Error ? e.message : "建群失败");
        setSubmitting(false);
      });
  }

  const submitDisabled = selectedCount === 0 || (selectedCount >= 2 && sanitizeGroupName(groupName) == null);

  return (
    <Modal
      open={open}
      title={
        <span className="inline-flex items-center gap-2">
          <TeamOutlined style={{ color: "#345d88" }} />
          发起会话
        </span>
      }
      onCancel={() => {
        if (!submitting) onClose();
      }}
      maskClosable={false}
      width={440}
      footer={[
        <Button key="cancel" disabled={submitting} onClick={onClose}>
          取消
        </Button>,
        <Button key="ok" type="primary" loading={submitting} disabled={submitDisabled} style={{ background: "#345d88" }} onClick={handleSubmit}>
          {selectedCount === 1 ? "发单聊" : `创建群聊${selectedCount > 0 ? `（${selectedCount + 1} 人）` : ""}`}
        </Button>,
      ]}
    >
      {loadError && <Alert type="error" title="联系人加载失败" action={<Button onClick={onRetry}>重试</Button>} className="mb-3" />}
      <p className="mb-3 text-xs text-[#778697]">选择一位同事开始单聊，选择多位同事创建群聊。</p>
      <div className="mb-2">
        <Input
          allowClear
          size="small"
          prefix={<SearchOutlined style={{ color: "#bfbfbf" }} />}
          placeholder="搜索用户（可拉离线用户入群）"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="max-h-72 min-h-40 overflow-y-auto rounded border border-[#f0f0f0]">
        {filtered.length === 0 ? (
          <div className="py-8">
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配的用户" />
          </div>
        ) : (
          filtered.map((u) => {
            const name = u.displayName || u.username;
            return (
              <label
                key={u.id}
                className="flex cursor-pointer items-center gap-2.5 px-3 py-2 hover:bg-[#fafafa]"
              >
                <Checkbox
                  checked={selectedIds.includes(u.id)}
                  onChange={(e) =>
                    setSelectedIds((prev) => (e.target.checked ? [...prev, u.id] : prev.filter((id) => id !== u.id)))
                  }
                />
                <Avatar size={28} style={{ background: moduleGradient("#345d88"), fontSize: 12 }}>
                  {name.slice(0, 1).toUpperCase()}
                </Avatar>
                <div className="min-w-0 flex-1">
                  <span className="truncate text-sm text-[#262626]">{name}</span>
                  <span className="ml-2 truncate text-[11px] text-[#8c8c8c]">@{u.username}</span>
                </div>
                {u.online ? (
                  <span className="text-[11px] text-[#52c41a]">在线</span>
                ) : (
                  <span className="text-[11px] text-[#bfbfbf]">离线</span>
                )}
              </label>
            );
          })
        )}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <span className="shrink-0 text-sm text-[#262626]">群名</span>
        <Input
          placeholder={`1~${GROUP_NAME_MAX} 字${selectedCount === 1 ? "（单选一人将直接发单聊）" : ""}`}
          value={groupName}
          maxLength={GROUP_NAME_MAX}
          allowClear
          onChange={(e) => setGroupName(e.target.value)}
          onPressEnter={handleSubmit}
        />
      </div>
    </Modal>
  );
}
