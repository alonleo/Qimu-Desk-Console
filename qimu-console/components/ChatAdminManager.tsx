"use client";

import { useCallback, useEffect, useState, type Key } from "react";
import {
  Button,
  Card,
  Drawer,
  Empty,
  Form,
  Input,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  message,
} from "antd";
import {
  DeleteOutlined,
  EyeOutlined,
  MessageOutlined,
  ReloadOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import BatchBar from "./batch/BatchBar";
import {
  CHAT_ADMIN_API,
  chatApiFetch,
  formatMessageTime,
  type ChatAdminConversation,
  type ChatAdminMessage,
} from "@/core/chat";

/**
 * 消息会话管理（chat-admin-module）：
 * 管理员查看/管理系统内全部用户之间的会话与消息（只读浏览 + 级联删除），
 * 不参与聊天本身。风格与 UsersManager / NoticesManager（若依风格）一致。
 */

type Query = { type: string[]; keyword: string };

type ConversationPage = {
  list: ChatAdminConversation[];
  total: number;
  page: number;
  size: number;
};

const SENDER_COLORS = ["#1677ff", "#13c2c2", "#52c41a", "#fa8c16", "#722ed1", "#eb2f96", "#fa541c"];

function senderColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return SENDER_COLORS[h % SENDER_COLORS.length];
}

const PAGE_SIZE = 20;

export default function ChatAdminManager() {
  const [query, setQuery] = useState<Query>({ type: [], keyword: "" });
  const [queryForm] = Form.useForm<Query>();

  const [list, setList] = useState<ChatAdminConversation[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([]);
  const [batchDeleting, setBatchDeleting] = useState(false);

  // 查看记录 Drawer 状态
  const [viewConv, setViewConv] = useState<ChatAdminConversation | null>(null);
  const [viewMessages, setViewMessages] = useState<ChatAdminMessage[]>([]);
  const [viewHasMore, setViewHasMore] = useState(false);
  const [viewLoading, setViewLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  /** 拉取会话列表（服务端分页 + 服务端筛选） */
  const load = useCallback(async (nextPage: number, nextSize: number, q: Query) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("page", String(nextPage));
      params.set("size", String(nextSize));
      if (q.type.length) params.set("types", q.type.join(","));
      const kw = q.keyword.trim();
      if (kw) params.set("keyword", kw);
      const data = await chatApiFetch<ConversationPage>(`${CHAT_ADMIN_API.conversations}?${params.toString()}`);
      setList(data.list ?? []);
      setTotal(Number(data.total ?? 0));
      setPage(data.page ?? nextPage);
      setSize(data.size ?? nextSize);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载会话列表失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(1, PAGE_SIZE, { type: [], keyword: "" });
  }, [load]);

  /** 拉取指定会话消息（首页 / 向上翻页均走这里） */
  async function fetchMessages(conversationId: number, beforeId?: number) {
    const params = new URLSearchParams();
    params.set("limit", "50");
    if (beforeId !== undefined) params.set("beforeId", String(beforeId));
    const data = await chatApiFetch<{ messages: ChatAdminMessage[]; hasMore: boolean }>(
      `${CHAT_ADMIN_API.messages(conversationId)}?${params.toString()}`
    );
    return data;
  }

  function openView(conv: ChatAdminConversation) {
    setViewConv(conv);
    setViewMessages([]);
    setViewHasMore(false);
    setViewLoading(true);
    fetchMessages(conv.conversationId)
      .then((data) => {
        setViewMessages(data.messages ?? []);
        setViewHasMore(Boolean(data.hasMore));
      })
      .catch((e) => message.error(e instanceof Error ? e.message : "加载消息失败"))
      .finally(() => setViewLoading(false));
  }

  function closeView() {
    setViewConv(null);
    setViewMessages([]);
    setViewHasMore(false);
  }

  async function loadMore() {
    if (!viewConv || viewMessages.length === 0) return;
    setLoadingMore(true);
    try {
      const beforeId = viewMessages[0].id;
      const data = await fetchMessages(viewConv.conversationId, beforeId);
      setViewMessages((prev) => [...(data.messages ?? []), ...prev]);
      setViewHasMore(Boolean(data.hasMore));
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载更多失败");
    } finally {
      setLoadingMore(false);
    }
  }

  async function removeConv(conv: ChatAdminConversation) {
    try {
      const data = await chatApiFetch<{ deleted: boolean; removedMessages: number }>(
        CHAT_ADMIN_API.remove(conv.conversationId),
        { method: "DELETE" }
      );
      message.success(`已删除会话，清除 ${data.removedMessages ?? 0} 条消息`);
      // 删除后当前页可能变空，回退一页
      const lastPage = Math.max(1, Math.ceil((total - 1) / size));
      void load(Math.min(page, lastPage), size, query);
      if (viewConv?.conversationId === conv.conversationId) closeView();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "删除失败");
    }
  }

  /** 批量删除选中会话（级联清理消息与成员关系） */
  async function batchDeleteConversations(): Promise<boolean> {
    if (selectedRowKeys.length === 0) return false;
    try {
      const data = await chatApiFetch<{ deleted: number; failed: number; removedMessages: number; errors?: { id?: number; error?: string }[] }>(
        CHAT_ADMIN_API.conversations + "/batch-delete",
        { method: "POST", body: JSON.stringify({ ids: selectedRowKeys }) }
      );
      const failed = Number(data.failed ?? 0);
      if (failed > 0) {
        const first = data.errors?.[0]?.error;
        message.warning(`批量删除成功 ${data.deleted} 个会话，失败 ${failed} 个${first ? `：${first}` : ""}`);
      } else {
        message.success(`批量删除成功 ${data.deleted} 个会话，清除 ${data.removedMessages ?? 0} 条消息`);
      }
      setSelectedRowKeys([]);
      const lastPage = Math.max(1, Math.ceil((total - data.deleted) / size));
      void load(Math.min(page, lastPage), size, query);
      return data.deleted > 0;
    } catch (e) {
      message.error(e instanceof Error ? e.message : "批量删除失败");
      return false;
    }
  }

  function convTitle(conv: ChatAdminConversation): string {
    if (conv.type === "group") {
      return `群聊「${conv.group?.name ?? ""}」`;
    }
    const names = (conv.participants ?? []).map((p) => p.displayName || p.username);
    return names.join(" ⇄ ");
  }

  const columns: ColumnsType<ChatAdminConversation> = [
    { title: "ID", dataIndex: "conversationId", width: 80 },
    {
      title: "类型",
      dataIndex: "type",
      width: 90,
      render: (v: string) =>
        v === "group" ? <Tag color="purple">群聊</Tag> : <Tag color="blue">单聊</Tag>,
    },
    {
      title: "参与方",
      key: "participants",
      render: (_, conv) =>
        conv.type === "group" ? (
          <span>
            {conv.group?.name ?? "—"}
            <span style={{ marginLeft: 8, fontSize: 12, color: "#8c8c8c" }}>
              {conv.group?.memberCount ?? 0} 人
            </span>
          </span>
        ) : (
          <span>
            {(conv.participants ?? [])
              .map((p) => p.displayName || p.username)
              .join(" ⇄ ") || "—"}
          </span>
        ),
    },
    { title: "消息数", dataIndex: "messageCount", width: 90, align: "right" },
    {
      title: "最近消息",
      dataIndex: "lastMessagePreview",
      ellipsis: { showTitle: false },
      render: (v: string) => <span style={{ color: "#595959" }}>{v || "—"}</span>,
    },
    {
      title: "最近消息时间",
      dataIndex: "lastMessageAt",
      width: 170,
      render: (v: string | null) => (
        <span style={{ color: "#8c8c8c", fontSize: 12 }}>{v || "—"}</span>
      ),
    },
    {
      title: "操作",
      key: "actions",
      width: 190,
      render: (_, conv) => (
        <Space>
          <Button
            type="primary"
            ghost
            size="small"
            icon={<EyeOutlined />}
            onClick={() => openView(conv)}
          >
            查看记录
          </Button>
          <Popconfirm
            title="删除该会话？"
            description={`将级联删除「${convTitle(conv)}」的全部消息与成员关系，不可恢复。`}
            okText="删除"
            okButtonProps={{ danger: true }}
            cancelText="取消"
            onConfirm={() => removeConv(conv)}
          >
            <Button danger size="small" icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* 查询表单（若依风格） */}
      <Card styles={{ body: { padding: "18px 16px 2px" } }}>
        <Form
          form={queryForm}
          layout="inline"
          initialValues={query}
          onFinish={(v) => {
            const q: Query = { type: v.type ?? [], keyword: v.keyword ?? "" };
            setQuery(q);
            void load(1, size, q);
          }}
        >
          <Form.Item name="type" label="类型" style={{ marginRight: 16 }}>
            <Select
              allowClear
              mode="multiple"
              placeholder="全部类型（可多选）"
              style={{ minWidth: 170 }}
              options={[
                { value: "single", label: "单聊" },
                { value: "group", label: "群聊" },
              ]}
            />
          </Form.Item>
          <Form.Item name="keyword" label="关键字" style={{ marginRight: 16 }}>
            <Input allowClear placeholder="用户昵称 / 用户名 / 群名" style={{ width: 220 }} />
          </Form.Item>
          <Form.Item style={{ marginRight: 0 }}>
            <Space>
              <Button type="primary" htmlType="submit" icon={<SearchOutlined />}>
                搜索
              </Button>
              <Button
                icon={<ReloadOutlined />}
                onClick={() => {
                  queryForm.resetFields();
                  const q: Query = { type: [], keyword: "" };
                  setQuery(q);
                  void load(1, PAGE_SIZE, q);
                }}
              >
                重置
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Card>

      {/* 表格卡片 */}
      <Card
        title={
          <span>
            <MessageOutlined style={{ marginRight: 8, color: "#9254de" }} />
            会话列表
            <Tag style={{ marginLeft: 10 }} color="blue">
              共 {total} 条
            </Tag>
          </span>
        }
      >
        <BatchBar
          selectedCount={selectedRowKeys.length}
          onClearSelection={() => setSelectedRowKeys([])}
          onBatchDelete={batchDeleteConversations}
          deleteDescription="选中的会话及其全部消息、成员关系将级联删除，不可恢复。"
        />
        <Table
          rowKey="conversationId"
          size="middle"
          loading={loading}
          columns={columns}
          dataSource={list}
          rowSelection={{ selectedRowKeys, onChange: (keys) => setSelectedRowKeys(keys) }}
          pagination={{
            current: page,
            pageSize: size,
            total,
            showSizeChanger: false,
            showTotal: (t) => `共 ${t} 条`,
            onChange: (p, s) => void load(p, s, query),
          }}
        />
      </Card>

      {/* 查看记录 Drawer（只读消息流） */}
      <Drawer
        title={viewConv ? `会话记录 — ${convTitle(viewConv)}` : "会话记录"}
        width={560}
        open={viewConv !== null}
        onClose={closeView}
        destroyOnHidden
      >
        {viewLoading ? (
          <div style={{ textAlign: "center", padding: 32, color: "#8c8c8c" }}>加载中…</div>
        ) : viewMessages.length === 0 ? (
          <Empty description="该会话暂无消息" />
        ) : (
          <>
            {viewHasMore && (
              <div style={{ textAlign: "center", marginBottom: 12 }}>
                <Button size="small" loading={loadingMore} onClick={() => void loadMore()}>
                  加载更多
                </Button>
              </div>
            )}
            <div style={{ display: "grid", gap: 14 }}>
              {viewMessages.map((m) => {
                const name = m.senderName || `用户${m.senderId}`;
                return (
                  <div key={m.id} style={{ display: "flex", gap: 10 }}>
                    <div
                      style={{
                        flexShrink: 0,
                        width: 32,
                        height: 32,
                        borderRadius: "50%",
                        background: senderColor(name),
                        color: "#fff",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 14,
                      }}
                    >
                      {name.slice(0, 1).toUpperCase()}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                        <span style={{ fontSize: 12, fontWeight: 500, color: senderColor(name) }}>
                          {name}
                        </span>
                        <Tooltip title={m.createdAt}>
                          <span style={{ fontSize: 12, color: "#8c8c8c" }}>
                            {formatMessageTime(m.createdAt)}
                          </span>
                        </Tooltip>
                        {m.isRead ? (
                          <span style={{ fontSize: 12, color: "#bfbfbf" }}>已读</span>
                        ) : (
                          <span style={{ fontSize: 12, color: "#faad14" }}>未读</span>
                        )}
                      </div>
                      <div
                        style={{
                          marginTop: 4,
                          display: "inline-block",
                          maxWidth: 420,
                          padding: "8px 12px",
                          borderRadius: 8,
                          borderTopLeftRadius: 2,
                          background: "#f5f5f5",
                          color: "rgba(0,0,0,.88)",
                          wordBreak: "break-word",
                          whiteSpace: "pre-wrap",
                        }}
                      >
                        {m.content}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </Drawer>
    </div>
  );
}
