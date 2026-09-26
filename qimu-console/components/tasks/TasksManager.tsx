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
  CheckOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  RestOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import BatchBar, { batchRequest } from "../batch/BatchBar";

export type TaskRow = {
  id: number;
  project_id: number | null;
  title: string;
  notes: string | null;
  status: "todo" | "doing" | "waiting" | "done";
  priority: "urgent" | "high" | "normal" | "low";
  due_date: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  project_name: string | null;
  project_color: string | null;
};

export type ProjectRow = { id: number; name: string; color: string | null };

const STATUS: Record<TaskRow["status"], { label: string; color: string }> = {
  todo: { label: "未开始", color: "default" },
  doing: { label: "进行中", color: "processing" },
  waiting: { label: "待办", color: "warning" },
  done: { label: "已完成", color: "success" },
};

const PRIORITY: Record<TaskRow["priority"], { label: string; color: string }> = {
  urgent: { label: "紧急", color: "red" },
  high: { label: "高", color: "orange" },
  normal: { label: "普通", color: "blue" },
  low: { label: "低", color: "default" },
};

type Query = { title: string; status: string[]; priority: string[] };

type TaskFormValues = {
  title: string;
  projectId?: number;
  status: TaskRow["status"];
  priority: TaskRow["priority"];
  dueDate?: string;
  notes?: string;
};

export default function TasksManager({ tasks, projects }: { tasks: TaskRow[]; projects: ProjectRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState<Query>({ title: "", status: [], priority: [] });
  const [queryForm] = Form.useForm<Query>();
  const [taskForm] = Form.useForm<TaskFormValues>();
  const [editing, setEditing] = useState<TaskRow | null>(null);
  const [open, setOpen] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([]);

  const filtered = useMemo(() => {
    const kw = query.title.trim().toLowerCase();
    return tasks.filter((t) => {
      if (kw && !t.title.toLowerCase().includes(kw) && !(t.notes ?? "").toLowerCase().includes(kw)) return false;
      if (query.status.length && !query.status.includes(t.status)) return false;
      if (query.priority.length && !query.priority.includes(t.priority)) return false;
      return true;
    });
  }, [tasks, query]);

  /** 批量操作成功后清空选中 */
  function clearSelection() {
    setSelectedRowKeys([]);
  }

  async function onBatchUpdate(patch: Record<string, unknown>) {
    const ok = await batchRequest("/api/tasks/batch-update", { ids: selectedRowKeys, data: patch }, "updated", "批量修改");
    if (ok) {
      clearSelection();
      router.refresh();
    }
    return ok;
  }

  async function onBatchDelete() {
    const ok = await batchRequest("/api/tasks/batch-delete", { ids: selectedRowKeys }, "deleted", "批量删除");
    if (ok) {
      clearSelection();
      router.refresh();
    }
    return ok;
  }

  async function onBatchCreate(items: Record<string, unknown>[]) {
    const ok = await batchRequest("/api/tasks/batch-create", { items }, "created", "批量新增");
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

  async function onSubmit(values: TaskFormValues) {
    const body = {
      title: values.title,
      projectId: values.projectId ?? null,
      status: values.status,
      priority: values.priority,
      dueDate: values.dueDate ?? "",
      notes: values.notes ?? "",
    };
    const ok = editing ? await call(`/api/tasks/${editing.id}`, "PATCH", body) : await call("/api/tasks", "POST", body);
    if (ok) {
      setOpen(false);
      setEditing(null);
    }
  }

  function openCreate() {
    setEditing(null);
    taskForm.resetFields();
    taskForm.setFieldsValue({ status: "todo", priority: "normal" });
    setOpen(true);
  }

  function openEdit(t: TaskRow) {
    setEditing(t);
    taskForm.setFieldsValue({
      title: t.title,
      projectId: t.project_id ?? undefined,
      status: t.status,
      priority: t.priority,
      dueDate: t.due_date ?? undefined,
      notes: t.notes ?? "",
    });
    setOpen(true);
  }

  const columns: ColumnsType<TaskRow> = [
    { title: "编号", dataIndex: "id", width: 70 },
    {
      title: "任务标题",
      dataIndex: "title",
      render: (_, t) => (
        <div>
          <span style={{ fontWeight: 500, textDecoration: t.status === "done" ? "line-through" : undefined, color: t.status === "done" ? "#8c8c8c" : undefined }}>
            {t.title}
          </span>
          {t.notes ? (
            <div style={{ fontSize: 12, color: "#8c8c8c", marginTop: 2 }} className="one-line">
              {t.notes}
            </div>
          ) : null}
        </div>
      ),
    },
    {
      title: "所属项目",
      dataIndex: "project_name",
      width: 130,
      render: (v: string | null, t) =>
        v ? <Tag color={t.project_color || "blue"}>{v}</Tag> : <span style={{ color: "#bfbfbf" }}>—</span>,
    },
    {
      title: "优先级",
      dataIndex: "priority",
      width: 90,
      render: (v: TaskRow["priority"]) => <Tag color={PRIORITY[v]?.color ?? "default"}>{PRIORITY[v]?.label ?? v}</Tag>,
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 90,
      render: (v: TaskRow["status"]) => <Tag color={STATUS[v]?.color ?? "default"}>{STATUS[v]?.label ?? v}</Tag>,
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
      title: "截止日期",
      dataIndex: "due_date",
      width: 110,
      render: (v: string | null) => v ?? <span style={{ color: "#bfbfbf" }}>—</span>,
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
      width: 230,
      render: (_, t) => (
        <Space>
          {t.status !== "done" ? (
            <Popconfirm title="标记为已完成？" okText="确定" cancelText="取消" onConfirm={() => call(`/api/tasks/${t.id}`, "PATCH", { status: "done" })}>
              <Button type="primary" ghost size="small" icon={<CheckOutlined />}>
                完成
              </Button>
            </Popconfirm>
          ) : null}
          <Button type="primary" ghost size="small" icon={<EditOutlined />} onClick={() => openEdit(t)}>
            修改
          </Button>
          <Popconfirm title="删除该任务？" okText="确定" cancelText="取消" onConfirm={() => call(`/api/tasks/${t.id}`, "DELETE")}>
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
          onFinish={(v) => setQuery({ title: v.title ?? "", status: v.status ?? [], priority: v.priority ?? [] })}
        >
          <Form.Item name="title" label="任务标题" style={{ marginRight: 16 }}>
            <Input allowClear placeholder="请输入任务标题" style={{ width: 200 }} />
          </Form.Item>
          <Form.Item name="status" label="状态" style={{ marginRight: 16 }}>
            <Select
              allowClear
              mode="multiple"
              maxTagCount="responsive"
              placeholder="任务状态（可多选）"
              style={{ minWidth: 160 }}
              options={Object.entries(STATUS).map(([value, s]) => ({ value, label: s.label }))}
            />
          </Form.Item>
          <Form.Item name="priority" label="优先级" style={{ marginRight: 16 }}>
            <Select
              allowClear
              mode="multiple"
              maxTagCount="responsive"
              placeholder="优先级（可多选）"
              style={{ minWidth: 150 }}
              options={Object.entries(PRIORITY).map(([value, p]) => ({ value, label: p.label }))}
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
                  setQuery({ title: "", status: [], priority: [] });
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
            任务列表
            <Tag style={{ marginLeft: 10 }} color="blue">
              {filtered.length} / {tasks.length}
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
              key: "status",
              label: "状态",
              type: "select",
              options: Object.entries(STATUS).map(([value, s]) => ({ value, label: s.label })),
            },
            {
              key: "priority",
              label: "优先级",
              type: "select",
              options: Object.entries(PRIORITY).map(([value, p]) => ({ value, label: p.label })),
            },
            { key: "projectId", label: "所属项目", type: "select", options: projects.map((p) => ({ value: p.id, label: p.name })) },
            { key: "dueDate", label: "截止日期", type: "text", placeholder: "yyyy-MM-dd" },
          ]}
          onBatchUpdate={onBatchUpdate}
          onBatchDelete={onBatchDelete}
          deleteDescription="选中的任务将全部删除，不可恢复。"
          onBatchCreate={onBatchCreate}
          createExample={`[
  { "title": "整理周报", "priority": "high", "status": "todo" },
  { "title": "同步需求文档", "status": "doing" }
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
        title={editing ? `修改任务：${editing.title}` : "新增任务"}
        open={open}
        onCancel={() => {
          setOpen(false);
          setEditing(null);
        }}
        footer={null}
      >
        <Form form={taskForm} layout="vertical" onFinish={onSubmit} requiredMark={false}>
          <Form.Item name="title" label="任务标题" rules={[{ required: true, message: "请输入任务标题" }]}>
            <Input placeholder="要做什么" />
          </Form.Item>
          <Form.Item name="projectId" label="所属项目">
            <Select
              allowClear
              placeholder="不关联项目"
              options={projects.map((p) => ({ value: p.id, label: p.name }))}
            />
          </Form.Item>
          <Space size={16} style={{ display: "flex" }}>
            <Form.Item name="status" label="状态" initialValue="todo" style={{ minWidth: 140 }}>
              <Select options={Object.entries(STATUS).map(([value, s]) => ({ value, label: s.label }))} />
            </Form.Item>
            <Form.Item name="priority" label="优先级" initialValue="normal" style={{ minWidth: 140 }}>
              <Select options={Object.entries(PRIORITY).map(([value, p]) => ({ value, label: p.label }))} />
            </Form.Item>
            <Form.Item name="dueDate" label="截止日期" style={{ minWidth: 160 }}>
              <Input type="date" />
            </Form.Item>
          </Space>
          <Form.Item name="notes" label="备注">
            <Input.TextArea rows={3} placeholder="补充说明（可选）" />
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
