"use client";

import { useMemo, useState, type Key } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  Card,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  message,
} from "antd";
import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  RestOutlined,
  RobotOutlined,
  SearchOutlined,
  StarFilled,
  StarOutlined,
} from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import CategoryPanel from "./CategoryPanel";
import BatchBar, { batchRequest } from "../batch/BatchBar";
import type { DocRow, CategoryRow, TagRow } from "./types";

export type { DocRow, CategoryRow, TagRow } from "./types";

/** 「AI 生成」来源 Tag：仅 source==='ai' 显示，其余不打扰手动条目 */
const AiTag = ({ source }: { source?: string }) =>
  source === "ai" ? (
    <Tag color="geekblue" icon={<RobotOutlined />}>
      AI 生成
    </Tag>
  ) : null;

type Query = { title: string; category: string[]; tag: string[] };

type DocFormValues = {
  title: string;
  category: string;
  tags: string;
  content: string;
};

export default function KnowledgeManager({
  initialDocs,
  initialCategories,
  initialTags,
}: {
  initialDocs: DocRow[];
  initialCategories: CategoryRow[];
  initialTags: TagRow[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState<Query>({ title: "", category: [], tag: [] });
  const [queryForm] = Form.useForm<Query>();
  const [docForm] = Form.useForm<DocFormValues>();
  const [editing, setEditing] = useState<DocRow | null>(null);
  const [docOpen, setDocOpen] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([]);

  const filtered = useMemo(() => {
    const kw = query.title.trim().toLowerCase();
    return initialDocs.filter((d) => {
      if (kw && !d.title.toLowerCase().includes(kw)) return false;
      if (query.category.length && !query.category.includes(d.category)) return false;
      if (query.tag.length && !query.tag.some((t) => d.tags.includes(t))) return false;
      return true;
    });
  }, [initialDocs, query]);

  function clearSelection() {
    setSelectedRowKeys([]);
  }

  async function onBatchUpdate(patch: Record<string, unknown>) {
    const ok = await batchRequest("/api/knowledge/batch-update", { ids: selectedRowKeys, data: patch }, "updated", "批量修改");
    if (ok) {
      clearSelection();
      router.refresh();
    }
    return ok;
  }

  async function onBatchDelete() {
    const ok = await batchRequest("/api/knowledge/batch-delete", { ids: selectedRowKeys }, "deleted", "批量删除");
    if (ok) {
      clearSelection();
      router.refresh();
    }
    return ok;
  }

  async function onBatchCreate(items: Record<string, unknown>[]) {
    const ok = await batchRequest("/api/knowledge/batch-create", { items }, "created", "批量新增");
    if (ok) router.refresh();
    return ok;
  }

  async function call(url: string, method: string, body?: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok || data.error) {
        message.error(data.error ?? "操作失败");
        return false;
      }
      message.success("操作成功");
      router.refresh();
      return true;
    } catch {
      message.error("网络错误，请重试");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function onSubmitDoc(values: DocFormValues) {
    const body = {
      title: values.title,
      category: values.category || "未分类",
      tags: values.tags
        ? values.tags
            .split(/[,，\s]+/)
            .map((t) => t.trim())
            .filter(Boolean)
        : [],
      content: values.content ?? "",
    };
    const ok = editing ? await call(`/api/knowledge/${editing.id}`, "PATCH", body) : await call("/api/knowledge", "POST", body);
    if (ok) {
      setDocOpen(false);
      setEditing(null);
      docForm.resetFields();
    }
  }

  function openCreate() {
    setEditing(null);
    docForm.resetFields();
    docForm.setFieldsValue({ category: "未分类", tags: "", content: "" });
    setDocOpen(true);
  }

  function openEdit(d: DocRow) {
    setEditing(d);
    docForm.setFieldsValue({
      title: d.title,
      category: d.category,
      tags: d.tags.join(", "),
      content: "",
    });
    setDocOpen(true);
  }

  const docColumns: ColumnsType<DocRow> = [
    { title: "编号", dataIndex: "id", width: 70 },
    {
      title: "标题",
      dataIndex: "title",
      render: (_, d) => (
        <div>
          <Space size={4}>
            {d.pinned ? <StarFilled style={{ color: "#faad14", fontSize: 13 }} /> : null}
            <span style={{ fontWeight: 500 }}>{d.title}</span>
          </Space>
          {d.excerpt ? (
            <div style={{ fontSize: 12, color: "#8c8c8c", marginTop: 2 }} className="one-line">
              {d.excerpt}
            </div>
          ) : null}
        </div>
      ),
    },
    {
      title: "分类",
      dataIndex: "category",
      width: 160,
      render: (_, d) => (
        <Space size={4}>
          <Tag color="blue">{d.category}</Tag>
          <AiTag source={d.source} />
        </Space>
      ),
    },
    {
      title: "标签",
      dataIndex: "tags",
      width: 200,
      render: (tags: string[]) =>
        tags.length ? (
          <Space size={4} wrap>
            {tags.slice(0, 3).map((t) => (
              <Tag key={t}>{t}</Tag>
            ))}
            {tags.length > 3 ? <Tag>+{tags.length - 3}</Tag> : null}
          </Space>
        ) : (
          <span style={{ color: "#bfbfbf" }}>—</span>
        ),
    },
    {
      title: "置顶",
      dataIndex: "pinned",
      width: 80,
      render: (_, d) => (
        <Button
          type="text"
          size="small"
          icon={d.pinned ? <StarFilled style={{ color: "#faad14" }} /> : <StarOutlined />}
          onClick={() => call(`/api/knowledge/${d.id}`, "PATCH", { pinned: !d.pinned })}
        />
      ),
    },
    { title: "创建人", dataIndex: "created_by", width: 90, render: (v) => v ?? "—" },
    {
      title: "可见性",
      dataIndex: "visibility",
      width: 90,
      render: (v: string | null | undefined) => (
        <Tag color={v === "personal" ? "gold" : "purple"} style={{ margin: 0 }}>
          {v === "personal" ? "个人" : "通用"}
        </Tag>
      ),
    },
    {
      title: "归属",
      dataIndex: "owner_name",
      width: 110,
      render: (v: string | null | undefined) => v ?? <span style={{ color: "#bfbfbf" }}>—</span>,
    },
    {
      title: "更新时间",
      dataIndex: "updated_at",
      width: 165,
      render: (v: string) => <span style={{ color: "#8c8c8c", fontSize: 12 }}>{v?.slice(0, 16)}</span>,
    },
    {
      title: "操作",
      key: "actions",
      width: 170,
      render: (_, d) => (
        <Space>
          <Button type="primary" ghost size="small" icon={<EditOutlined />} onClick={() => openEdit(d)}>
            修改
          </Button>
          <Popconfirm title="删除该文档？不可恢复。" okText="确定" cancelText="取消" onConfirm={() => call(`/api/knowledge/${d.id}`, "DELETE")}>
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
      <Card styles={{ body: { padding: "18px 16px 2px" } }}>
        <Form
          form={queryForm}
          layout="inline"
          onFinish={(v) => setQuery({ title: v.title ?? "", category: v.category ?? [], tag: v.tag ?? [] })}
        >
          <Form.Item name="title" label="标题" style={{ marginRight: 16 }}>
            <Input allowClear placeholder="请输入文档标题" style={{ width: 200 }} />
          </Form.Item>
          <Form.Item name="category" label="分类" style={{ marginRight: 16 }}>
            <Select
              allowClear
              mode="multiple"
              maxTagCount="responsive"
              placeholder="全部分类（可多选）"
              style={{ minWidth: 170 }}
              options={initialCategories.map((c) => ({ value: c.name, label: c.name }))}
            />
          </Form.Item>
          <Form.Item name="tag" label="标签" style={{ marginRight: 16 }}>
            <Select
              allowClear
              mode="multiple"
              maxTagCount="responsive"
              placeholder="全部标签（可多选）"
              style={{ minWidth: 170 }}
              options={initialTags.map((t) => ({ value: t.name, label: `${t.name} (${t.count})` }))}
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
                  setQuery({ title: "", category: [], tag: [] });
                }}
              >
                重置
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Card>

      <Card
        title={
          <span>
            文档列表
            <Tag style={{ marginLeft: 10 }} color="blue">
              {filtered.length} / {initialDocs.length}
            </Tag>
          </span>
        }
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新增
          </Button>
        }
      >
        <BatchBar
          selectedCount={selectedRowKeys.length}
          onClearSelection={clearSelection}
          fields={[
            {
              key: "category",
              label: "分类",
              type: "select",
              options: initialCategories.map((c) => ({ value: c.name, label: c.name })),
            },
            { key: "pinned", label: "置顶", type: "switch", checkedText: "置顶", uncheckedText: "取消" },
          ]}
          onBatchUpdate={onBatchUpdate}
          onBatchDelete={onBatchDelete}
          deleteDescription="选中的文档将全部删除，不可恢复。"
          onBatchCreate={onBatchCreate}
          createExample={`[
  { "title": "部署手册", "category": "运维", "tags": ["部署"], "content": "# 正文" },
  { "title": "会议纪要", "category": "未分类" }
]`}
        />
        <Table
          rowKey="id"
          size="middle"
          columns={docColumns}
          dataSource={filtered}
          rowSelection={{ selectedRowKeys, onChange: (keys) => setSelectedRowKeys(keys) }}
          pagination={{ pageSize: 10, showTotal: (t) => `共 ${t} 条` }}
        />
      </Card>

      <CategoryPanel categories={initialCategories} busy={busy} call={call} />

      <Modal
        title={editing ? `修改文档：${editing.title}` : "新增文档"}
        open={docOpen}
        onCancel={() => {
          setDocOpen(false);
          setEditing(null);
        }}
        footer={null}
        width={640}
      >
        <Form form={docForm} layout="vertical" onFinish={onSubmitDoc} requiredMark={false}>
          <Form.Item name="title" label="标题" rules={[{ required: true, message: "请输入文档标题" }]}>
            <Input placeholder="文档标题" />
          </Form.Item>
          <Space size={16} style={{ display: "flex" }}>
            <Form.Item name="category" label="分类" initialValue="未分类" style={{ minWidth: 220 }}>
              <Select placeholder="选择分类" options={initialCategories.map((c) => ({ value: c.name, label: c.name }))} />
            </Form.Item>
            <Form.Item name="tags" label="标签（逗号分隔）" style={{ minWidth: 260 }}>
              <Input placeholder="如：指南, 运维" />
            </Form.Item>
          </Space>
          <Form.Item
            name="content"
            label={editing ? `正文（留空表示不修改，当前 ${editing.excerpt.length > 0 ? "已有内容" : "为空"}）` : "正文"}
          >
            <Input.TextArea rows={8} placeholder="支持 Markdown" />
          </Form.Item>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Button
              onClick={() => {
                setDocOpen(false);
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
