"use client";

import { useCallback, useState, type Key } from "react";
import {
  Button,
  Card,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  message,
} from "antd";
import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  PushpinFilled,
  PushpinOutlined,
  RestOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import BatchBar, { batchRequest } from "./batch/BatchBar";

/** notice 行结构（snake_case，与后端输出一致） */
export type NoticeRow = {
  id: number;
  type: "notification" | "announcement";
  title: string;
  content: string | null;
  is_pinned: number;
  status: "draft" | "published";
  publisher_id: number | null;
  publisher_name: string | null;
  publish_time: string | null;
  expire_time: string | null;
  create_time: string;
  update_time: string;
};

type Query = { type: string[]; status: string[]; title: string };

const TYPE_LABELS: Record<string, string> = { announcement: "公告", notification: "通知" };
const TYPE_COLORS: Record<string, string> = { announcement: "#fa541c", notification: "#1677ff" };

export default function NoticesManager({
  initialNotices,
  initialTotal,
  initialPage,
  initialPageSize,
}: {
  initialNotices: NoticeRow[];
  initialTotal: number;
  initialPage: number;
  initialPageSize: number;
}) {
  const [notices, setNotices] = useState<NoticeRow[]>(initialNotices);
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage] = useState(initialPage);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [query, setQuery] = useState<Query>({ type: [], status: [], title: "" });
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<NoticeRow | null>(null);
  const [queryForm] = Form.useForm<Query>();
  const [editForm] = Form.useForm();
  const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([]);

  function clearSelection() {
    setSelectedRowKeys([]);
  }

  async function onBatchUpdate(patch: Record<string, unknown>) {
    const ok = await batchRequest("/api/notices/batch-update", { ids: selectedRowKeys, data: patch }, "updated", "批量修改");
    if (ok) {
      clearSelection();
      await loadList(page, pageSize, query);
    }
    return ok;
  }

  async function onBatchDelete() {
    const ok = await batchRequest("/api/notices/batch-delete", { ids: selectedRowKeys }, "deleted", "批量删除");
    if (ok) {
      clearSelection();
      // 批量删除后当前页可能变空，回退到有效页
      const lastPage = Math.max(1, Math.ceil((total - selectedRowKeys.length) / pageSize));
      await loadList(Math.min(page, lastPage), pageSize, query);
    }
    return ok;
  }

  async function onBatchCreate(items: Record<string, unknown>[]) {
    const ok = await batchRequest("/api/notices/batch-create", { items }, "created", "批量新增");
    if (ok) await loadList(1, pageSize, query);
    return ok;
  }

  /** 服务端分页加载列表（同源请求，浏览器自动携带 token cookie） */
  const loadList = useCallback(
    async (p: number, ps: number, q: Query) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ page: String(p), pageSize: String(ps) });
        if (q.type.length) params.set("types", q.type.join(","));
        if (q.status.length) params.set("statuses", q.status.join(","));
        if (q.title.trim()) params.set("title", q.title.trim());
        const res = await fetch(`/api/notices?${params.toString()}`);
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          total?: number;
          page?: number;
          pageSize?: number;
          notices?: NoticeRow[];
          error?: string;
        };
        if (!res.ok || data.ok === false) {
          message.error(data.error ?? "加载通知列表失败");
          return;
        }
        setNotices(data.notices ?? []);
        setTotal(data.total ?? 0);
        setPage(data.page ?? p);
        setPageSize(data.pageSize ?? ps);
      } catch {
        message.error("网络错误，请重试");
      } finally {
        setLoading(false);
      }
    },
    []
  );

  /** 写操作统一入口：兼容 HTTP 200 + {ok:false} 业务错误与 4xx 权限错误 */
  async function call(url: string, method: string, body?: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || data.ok === false) {
        message.error(data.error ?? "操作失败");
        return false;
      }
      message.success("操作成功");
      await loadList(page, pageSize, query);
      return true;
    } catch {
      message.error("网络错误，请重试");
      return false;
    } finally {
      setBusy(false);
    }
  }

  function openCreate() {
    setEditing(null);
    editForm.resetFields();
    editForm.setFieldsValue({ type: "announcement", is_pinned: false });
    setModalOpen(true);
  }

  function openEdit(n: NoticeRow) {
    setEditing(n);
    editForm.setFieldsValue({
      type: n.type,
      title: n.title,
      content: n.content ?? "",
      is_pinned: n.is_pinned === 1,
    });
    setModalOpen(true);
  }

  async function onSubmit(values: { type: "notification" | "announcement"; title: string; content?: string; is_pinned: boolean }) {
    const payload = {
      type: values.type,
      title: values.title.trim(),
      content: values.content ?? "",
      is_pinned: values.is_pinned ? 1 : 0,
      status: "published" as const,
    };
    const ok = editing
      ? await call(`/api/notices/${editing.id}`, "PUT", payload)
      : await call("/api/notices", "POST", payload);
    if (ok) {
      setModalOpen(false);
      editForm.resetFields();
      setEditing(null);
    }
  }

  /** 删除：若当前页仅剩该条且不是第一页，自动回退到上一页，避免停留空页 */
  async function onDelete(n: NoticeRow) {
    const isLastOnPage = notices.length === 1;
    const ok = await call(`/api/notices/${n.id}`, "DELETE");
    if (ok && isLastOnPage && page > 1) await loadList(page - 1, pageSize, query);
  }

  const columns: ColumnsType<NoticeRow> = [
    { title: "编号", dataIndex: "id", width: 80 },
    {
      title: "类型",
      dataIndex: "type",
      width: 90,
      render: (v: string) => <Tag color={TYPE_COLORS[v] || "#1677ff"}>{TYPE_LABELS[v] ?? v}</Tag>,
    },
    {
      title: "标题",
      dataIndex: "title",
      render: (_, n) => (
        <Space size={6}>
          {n.is_pinned === 1 && <PushpinFilled style={{ color: "#fa8c16" }} title="置顶" />}
          <span style={{ fontWeight: 500 }}>{n.title}</span>
        </Space>
      ),
    },
    {
      title: "发布人",
      dataIndex: "publisher_name",
      width: 120,
      render: (v: string | null) => <span style={{ color: "#8c8c8c" }}>{v ?? "—"}</span>,
    },
    {
      title: "发布时间",
      dataIndex: "publish_time",
      width: 170,
      render: (v: string | null) => <span style={{ color: "#8c8c8c", fontSize: 12 }}>{v ?? "—"}</span>,
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 90,
      render: (v: string) =>
        v === "published" ? <Tag color="green">已发布</Tag> : <Tag color="default">草稿</Tag>,
    },
    {
      title: "操作",
      key: "actions",
      width: 260,
      render: (_, n) => (
        <Space>
          <Button type="primary" ghost size="small" icon={<EditOutlined />} onClick={() => openEdit(n)}>
            编辑
          </Button>
          <Popconfirm
            title={n.is_pinned === 1 ? "取消置顶该通知？" : "置顶该通知？"}
            okText="确定"
            cancelText="取消"
            onConfirm={() => call(`/api/notices/${n.id}/pin`, "PATCH", { is_pinned: n.is_pinned === 1 ? 0 : 1 })}
          >
            <Button type="primary" ghost size="small" icon={n.is_pinned === 1 ? <PushpinOutlined /> : <PushpinFilled />}>
              {n.is_pinned === 1 ? "取消置顶" : "置顶"}
            </Button>
          </Popconfirm>
          <Popconfirm title="删除该通知？" description="删除后不可恢复。" okText="确定" cancelText="取消" onConfirm={() => onDelete(n)}>
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
            const q: Query = { type: v.type ?? [], status: v.status ?? [], title: v.title ?? "" };
            setQuery(q);
            loadList(1, pageSize, q);
          }}
        >
          <Form.Item name="title" label="标题" style={{ marginRight: 16 }}>
            <Input allowClear placeholder="请输入标题关键字" style={{ width: 200 }} />
          </Form.Item>
          <Form.Item name="type" label="类型" style={{ marginRight: 16 }}>
            <Select
              allowClear
              mode="multiple"
              maxTagCount="responsive"
              placeholder="全部类型（可多选）"
              style={{ minWidth: 170 }}
              options={[
                { value: "announcement", label: "公告" },
                { value: "notification", label: "通知" },
              ]}
            />
          </Form.Item>
          <Form.Item name="status" label="状态" style={{ marginRight: 16 }}>
            <Select
              allowClear
              mode="multiple"
              maxTagCount="responsive"
              placeholder="全部状态（可多选）"
              style={{ minWidth: 170 }}
              options={[
                { value: "published", label: "已发布" },
                { value: "draft", label: "草稿" },
              ]}
            />
          </Form.Item>
          <Form.Item style={{ marginRight: 0 }}>
            <Space>
              <Button type="primary" htmlType="submit" icon={<SearchOutlined />}>
                搜索
              </Button>
              <Button
                icon={<RestOutlined />}
                onClick={() => {
                  queryForm.resetFields();
                  const q: Query = { type: [], status: [], title: "" };
                  setQuery(q);
                  loadList(1, pageSize, q);
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
            通知公告列表
            <Tag style={{ marginLeft: 10 }} color="blue">
              共 {total} 条
            </Tag>
          </span>
        }
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新建通知
          </Button>
        }
      >
        <BatchBar
          selectedCount={selectedRowKeys.length}
          onClearSelection={clearSelection}
          fields={[
            {
              key: "type",
              label: "类型",
              type: "select",
              options: [
                { value: "announcement", label: "公告" },
                { value: "notification", label: "通知" },
              ],
            },
            {
              key: "status",
              label: "状态",
              type: "select",
              options: [
                { value: "published", label: "已发布" },
                { value: "draft", label: "草稿" },
              ],
            },
            { key: "is_pinned", label: "置顶", type: "switch", checkedText: "置顶", uncheckedText: "取消" },
          ]}
          onBatchUpdate={onBatchUpdate}
          onBatchDelete={onBatchDelete}
          deleteDescription="选中的通知公告将全部删除，不可恢复。"
          onBatchCreate={onBatchCreate}
          createExample={`[
  { "type": "announcement", "title": "系统维护公告", "content": "今晚 22:00 维护", "is_pinned": 1 },
  { "type": "notification", "title": "新版本上线提醒" }
]`}
        />
        <Table
          rowKey="id"
          size="middle"
          loading={loading}
          columns={columns}
          dataSource={notices}
          rowSelection={{ selectedRowKeys, onChange: (keys) => setSelectedRowKeys(keys) }}
          pagination={{
            current: page,
            pageSize,
            total,
            showTotal: (t) => `共 ${t} 条`,
            showSizeChanger: true,
            onChange: (p, ps) => loadList(p, ps, query),
          }}
        />
      </Card>

      {/* 新建 / 编辑弹窗（保存即发布） */}
      <Modal
        title={editing ? `编辑通知公告：${editing.title}` : "新建通知公告"}
        open={modalOpen}
        onCancel={() => {
          setModalOpen(false);
          editForm.resetFields();
          setEditing(null);
        }}
        footer={null}
        width={640}
      >
        <Form form={editForm} layout="vertical" onFinish={onSubmit} requiredMark={false}>
          <Form.Item name="type" label="类型" initialValue="announcement" rules={[{ required: true, message: "请选择类型" }]}>
            <Select
              options={[
                { value: "announcement", label: "公告（面向全员）" },
                { value: "notification", label: "通知（定向消息）" },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="title"
            label="标题"
            rules={[{ required: true, message: "请输入标题" }, { max: 255, message: "标题不超过 255 字" }]}
          >
            <Input placeholder="请输入标题" />
          </Form.Item>
          <Form.Item name="content" label="内容">
            <Input.TextArea rows={8} placeholder="支持多行文本" />
          </Form.Item>
          <Form.Item name="is_pinned" label="置顶" valuePropName="checked" initialValue={false}>
            <Switch checkedChildren="置顶" unCheckedChildren="常规" />
          </Form.Item>
          <div style={{ fontSize: 12, color: "#8c8c8c", marginBottom: 16 }}>保存后立即发布，工作台全员可见。</div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Button
              onClick={() => {
                setModalOpen(false);
                editForm.resetFields();
                setEditing(null);
              }}
            >
              取 消
            </Button>
            <Button type="primary" htmlType="submit" loading={busy}>
              确 定
            </Button>
          </div>
        </Form>
      </Modal>
    </div>
  );
}
