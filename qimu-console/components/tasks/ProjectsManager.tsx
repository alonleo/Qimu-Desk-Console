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
  Progress,
  Select,
  Space,
  Table,
  Tag,
  message,
} from "antd";
import {
  DeleteOutlined,
  EditOutlined,
  FolderOutlined,
  PlusOutlined,
  RestOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import BatchBar, { batchRequest } from "../batch/BatchBar";

export type ProjectRow = {
  id: number;
  name: string;
  description: string | null;
  color: string | null;
  status: string | null;
  created_at: string | null;
  updated_at: string | null;
  task_count: number;
  done_count: number;
  open_count: number;
};

type Query = { name: string; status: string[] };

type ProjectFormValues = {
  name: string;
  description?: string;
  color?: string;
};

const PROJECT_COLORS = [
  "#1677ff", "#52c41a", "#fa8c16", "#eb2f96",
  "#722ed1", "#13c2c2", "#faad14", "#f5222d",
];

export default function ProjectsManager({ projects }: { projects: ProjectRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState<Query>({ name: "", status: [] });
  const [queryForm] = Form.useForm<Query>();
  const [projectForm] = Form.useForm<ProjectFormValues>();
  const [editing, setEditing] = useState<ProjectRow | null>(null);
  const [open, setOpen] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([]);

  const filtered = useMemo(() => {
    const kw = query.name.trim().toLowerCase();
    return projects.filter((p) => {
      if (kw && !p.name.toLowerCase().includes(kw)) return false;
      if (query.status.length && !query.status.includes(p.status ?? "active")) return false;
      return true;
    });
  }, [projects, query]);

  /** 批量操作成功后清空选中 */
  function clearSelection() {
    setSelectedRowKeys([]);
  }

  async function onBatchUpdate(patch: Record<string, unknown>) {
    const ok = await batchRequest("/api/projects/batch-update", { ids: selectedRowKeys, data: patch }, "updated", "批量修改");
    if (ok) {
      clearSelection();
      router.refresh();
    }
    return ok;
  }

  async function onBatchDelete() {
    const ok = await batchRequest("/api/projects/batch-delete", { ids: selectedRowKeys }, "deleted", "批量删除");
    if (ok) {
      clearSelection();
      router.refresh();
    }
    return ok;
  }

  async function onBatchCreate(items: Record<string, unknown>[]) {
    const ok = await batchRequest("/api/projects/batch-create", { items }, "created", "批量新增");
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

  async function onSubmit(values: ProjectFormValues) {
    const body = {
      name: values.name,
      description: values.description ?? "",
      color: values.color ?? PROJECT_COLORS[0],
    };
    const ok = editing
      ? await call(`/api/projects/${editing.id}`, "PATCH", body)
      : await call("/api/projects", "POST", body);
    if (ok) {
      setOpen(false);
      setEditing(null);
    }
  }

  function openCreate() {
    setEditing(null);
    projectForm.resetFields();
    projectForm.setFieldsValue({ color: PROJECT_COLORS[0] });
    setOpen(true);
  }

  function openEdit(p: ProjectRow) {
    setEditing(p);
    projectForm.setFieldsValue({
      name: p.name,
      description: p.description ?? "",
      color: p.color || PROJECT_COLORS[0],
    });
    setOpen(true);
  }

  const columns: ColumnsType<ProjectRow> = [
    { title: "编号", dataIndex: "id", width: 70 },
    {
      title: "项目名称",
      dataIndex: "name",
      render: (_, p) => (
        <Space size={8}>
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: 3,
              background: p.color || "#1677ff",
              display: "inline-block",
            }}
          />
          <span style={{ fontWeight: 500 }}>{p.name}</span>
        </Space>
      ),
    },
    {
      title: "描述",
      dataIndex: "description",
      render: (v: string | null) =>
        v ? (
          <div className="one-line" style={{ maxWidth: 260, fontSize: 12, color: "#8c8c8c" }}>
            {v}
          </div>
        ) : (
          <span style={{ color: "#bfbfbf" }}>—</span>
        ),
    },
    {
      title: "任务进度",
      key: "progress",
      width: 190,
      render: (_, p) => {
        const total = p.task_count ?? 0;
        const done = p.done_count ?? 0;
        const pct = total > 0 ? Math.round((done / total) * 100) : 0;
        return (
          <div style={{ maxWidth: 160 }}>
            <div style={{ fontSize: 12, color: "#8c8c8c", marginBottom: 2 }}>
              {done} / {total} 完成
            </div>
            <Progress percent={pct} showInfo={false} strokeColor={p.color || "#1677ff"} size="small" />
          </div>
        );
      },
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 90,
      render: (v: string | null) =>
        v === "archived" ? <Tag color="default">已归档</Tag> : <Tag color="processing">进行中</Tag>,
    },
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
      title: "创建人",
      dataIndex: "owner_name",
      width: 110,
      render: (v: string | null | undefined) => v ?? <span style={{ color: "#bfbfbf" }}>—</span>,
    },
    {
      title: "创建时间",
      dataIndex: "created_at",
      width: 165,
      render: (v: string | null) => <span style={{ color: "#8c8c8c", fontSize: 12 }}>{v?.slice(0, 16) ?? "—"}</span>,
    },
    {
      title: "操作",
      key: "actions",
      width: 200,
      render: (_, p) => (
        <Space>
          {p.status !== "archived" ? (
            <Popconfirm title="归档该项目？" okText="确定" cancelText="取消" onConfirm={() => call(`/api/projects/${p.id}`, "PATCH", { status: "archived" })}>
              <Button type="primary" ghost size="small" icon={<FolderOutlined />}>
                归档
              </Button>
            </Popconfirm>
          ) : (
            <Button
              type="primary"
              ghost
              size="small"
              icon={<FolderOutlined />}
              onClick={() => call(`/api/projects/${p.id}`, "PATCH", { status: "active" })}
            >
              恢复
            </Button>
          )}
          <Button type="primary" ghost size="small" icon={<EditOutlined />} onClick={() => openEdit(p)}>
            修改
          </Button>
          <Popconfirm title="删除该项目？任务将取消关联。" okText="确定" cancelText="取消" onConfirm={() => call(`/api/projects/${p.id}`, "DELETE")}>
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
          onFinish={(v) => setQuery({ name: v.name ?? "", status: v.status ?? [] })}
        >
          <Form.Item name="name" label="项目名称" style={{ marginRight: 16 }}>
            <Input allowClear placeholder="请输入项目名称" style={{ width: 200 }} />
          </Form.Item>
          <Form.Item name="status" label="状态" style={{ marginRight: 16 }}>
            <Select
              allowClear
              mode="multiple"
              maxTagCount="responsive"
              placeholder="项目状态（可多选）"
              style={{ minWidth: 160 }}
              options={[
                { value: "active", label: "进行中" },
                { value: "archived", label: "已归档" },
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
                  setQuery({ name: "", status: [] });
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
            项目列表
            <Tag style={{ marginLeft: 10 }} color="blue">
              {filtered.length} / {projects.length}
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
            { key: "name", label: "项目名称", type: "text" },
            { key: "color", label: "颜色", type: "text", placeholder: "#1677ff" },
            {
              key: "status",
              label: "状态",
              type: "select",
              options: [
                { value: "active", label: "进行中" },
                { value: "archived", label: "已归档" },
              ],
            },
          ]}
          onBatchUpdate={onBatchUpdate}
          onBatchDelete={onBatchDelete}
          deleteDescription="选中的项目将全部删除，关联任务将取消关联，不可恢复。"
          onBatchCreate={onBatchCreate}
          createExample={`[
  { "name": "产品迭代", "color": "#1677ff" },
  { "name": "读书计划", "color": "#52c41a" }
]`}
        />
        <Table
          rowKey="id"
          size="middle"
          columns={columns}
          dataSource={filtered}
          rowSelection={{ selectedRowKeys, onChange: (keys) => setSelectedRowKeys(keys) }}
          pagination={{ pageSize: 10, showTotal: (t) => `共 ${t} 条` }}
        />
      </Card>

      <Modal
        title={editing ? `修改项目：${editing.name}` : "新增项目"}
        open={open}
        onCancel={() => {
          setOpen(false);
          setEditing(null);
        }}
        footer={null}
      >
        <Form form={projectForm} layout="vertical" onFinish={onSubmit} requiredMark={false}>
          <Form.Item name="name" label="项目名称" rules={[{ required: true, message: "请输入项目名称" }]}>
            <Input placeholder="比如：产品迭代、读书计划…" />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={2} placeholder="项目简述（可选）" />
          </Form.Item>
          <Form.Item name="color" label="项目颜色">
            <Select
              options={PROJECT_COLORS.map((c) => ({
                value: c,
                label: (
                  <Space size={8}>
                    <span style={{ width: 12, height: 12, borderRadius: 3, background: c, display: "inline-block" }} />
                    {c}
                  </Space>
                ),
              }))}
            />
          </Form.Item>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Button
              onClick={() => {
                setOpen(false);
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
