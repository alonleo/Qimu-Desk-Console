"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  Form,
  Input,
  Modal,
  Popconfirm,
  Segmented,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from "antd";
import {
  AppstoreOutlined,
  ClockCircleOutlined,
  DeleteOutlined,
  EditOutlined,
  FieldTimeOutlined,
  PlusOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import {
  type TaskRow,
  type ProjectRow,
  type TaskStatus,
  type TaskPriority,
  type TaskPeriod,
  STATUS_META,
  STATUS_ORDER,
  PRIORITY_META,
  PERIOD_META,
  PERIOD_ORDER,
  PROJECT_COLORS,
} from "./types";
import { moduleGradient } from "../modules";
import VisibilityTag from "@/components/VisibilityTag";

const { Text } = Typography;

export default function TasksView({
  tasks,
  projects,
}: {
  tasks: TaskRow[];
  projects: ProjectRow[];
}) {
  const router = useRouter();
  const [view, setView] = useState<"list" | "kanban">("kanban");
  const [projectId, setProjectId] = useState<string>("all");
  const [formOpen, setFormOpen] = useState(false);
  const [editTask, setEditTask] = useState<TaskRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [form] = Form.useForm();
  // 天任务用「时间」（时:分），其余周期用「日期」
  const period = Form.useWatch("period", form);
  const isDaily = period === "daily";

  const filtered = projectId === "all"
    ? tasks
    : tasks.filter((t) => t.project_id === Number(projectId));

  const call = useCallback(
    async (url: string, method: string, body?: Record<string, unknown>) => {
      setBusy(true);
      try {
        const res = await fetch(url, {
          method,
          headers: { "Content-Type": "application/json" },
          body: body ? JSON.stringify(body) : undefined,
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          message.error(data.error ?? "操作失败");
          return false;
        }
        router.refresh();
        return true;
      } catch {
        message.error("网络错误");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [router]
  );

  function openCreate() {
    setEditTask(null);
    form.resetFields();
    form.setFieldsValue({
      projectId: projectId === "all" ? undefined : Number(projectId),
      status: "todo",
      priority: "normal",
      period: "",
    });
    setFormOpen(true);
  }

  function openEdit(task: TaskRow) {
    setEditTask(task);
    form.setFieldsValue({
      title: task.title,
      projectId: task.project_id ?? undefined,
      status: task.status,
      priority: task.priority,
      period: task.period ?? undefined,
      startDate: task.start_date ?? undefined,
      dueDate: task.due_date ?? undefined,
      notes: task.notes ?? "",
    });
    setFormOpen(true);
  }

  async function onSubmit(values: {
    title: string;
    projectId?: number;
    status: TaskStatus;
    priority: TaskPriority;
    period?: TaskPeriod;
    startDate?: string;
    dueDate?: string;
    notes?: string;
  }) {
    // 时间段校验：开始不得晚于截止（时间/日期字符串均可按字典序比较）
    if (values.startDate && values.dueDate && values.startDate > values.dueDate) {
      message.error(isDaily ? "开始时间不能晚于截止时间" : "开始日期不能晚于截止日期");
      return;
    }
    const body: Record<string, unknown> = {
      title: values.title,
      projectId: values.projectId ?? null,
      status: values.status,
      priority: values.priority,
      period: values.period || null,
      startDate: values.startDate || null,
      dueDate: values.dueDate || null,
      notes: values.notes || null,
    };
    if (editTask) {
      await call(`/api/tasks/${editTask.id}`, "PATCH", body);
    } else {
      await call("/api/tasks", "POST", body);
    }
    setFormOpen(false);
  }

  async function quickStatus(task: TaskRow, status: TaskStatus) {
    await call(`/api/tasks/${task.id}`, "PATCH", { status });
  }

  async function onDelete(task: TaskRow) {
    await call(`/api/tasks/${task.id}`, "DELETE");
  }

  // ---- 列表视图列 ----
  const columns: ColumnsType<TaskRow> = [
    {
      title: "日常任务",
      key: "title",
      render: (_, t) => (
        <div>
          <div style={{ fontWeight: 500, color: t.status === "done" ? "#8c8c8c" : undefined }}>
            {t.title}
          </div>
          {t.notes && (
            <div style={{ fontSize: 12, color: "#8c8c8c", marginTop: 2, maxWidth: 300,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {t.notes}
            </div>
          )}
        </div>
      ),
    },
    {
      title: "项目",
      key: "project",
      width: 140,
      render: (_, t) =>
        t.project_name ? (
          <Space size={4}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                display: "inline-block",
                background: t.project_color || "#1677ff",
              }}
            />
            <Text style={{ fontSize: 13 }}>{t.project_name}</Text>
          </Space>
        ) : (
          <Text type="secondary" style={{ fontSize: 12 }}>—</Text>
        ),
    },
    {
      title: "状态",
      key: "status",
      width: 100,
      render: (_, t) => {
        const m = STATUS_META[t.status];
        return (
          <Tag
            color={t.status === "done" ? "success" : t.status === "doing" ? "warning" : t.status === "waiting" ? "purple" : "processing"}
            style={{ borderRadius: 6 }}
          >
            {m.label}
          </Tag>
        );
      },
    },
    {
      title: "优先级",
      key: "priority",
      width: 80,
      render: (_, t) => {
        const m = PRIORITY_META[t.priority];
        return <Tag color={m.color} style={{ borderRadius: 6 }}>{m.label}</Tag>;
      },
    },
    {
      title: "周期",
      key: "period",
      width: 90,
      render: (_, t) => {
        if (!t.period) return <Text type="secondary" style={{ fontSize: 12 }}>—</Text>;
        const m = PERIOD_META[t.period];
        return <Tag color={m.color} style={{ borderRadius: 6 }}>{m.label}</Tag>;
      },
    },
    {
      title: "可见性",
      key: "visibility",
      width: 90,
      render: (_, t) => <VisibilityTag value={t.visibility} />,
    },
    {
      title: "时间段",
      key: "time_range",
      width: 200,
      render: (_, t) => {
        if (!t.start_date && !t.due_date) {
          return <Text type="secondary" style={{ fontSize: 12 }}>—</Text>;
        }
        return (
          <Space size={4}>
            <ClockCircleOutlined style={{ color: "#8c8c8c" }} />
            <Text style={{ fontSize: 12 }}>
              {t.start_date ? t.start_date : "…"} ~ {t.due_date ? t.due_date : "…"}
            </Text>
          </Space>
        );
      },
    },
    {
      title: "操作",
      key: "actions",
      align: "right" as const,
      width: 120,
      render: (_, t) => (
        <Space size={4}>
          <Tooltip title="编辑">
            <Button type="text" size="small" icon={<EditOutlined />} onClick={() => openEdit(t)} />
          </Tooltip>
          <Popconfirm title="删除此日常任务？" okText="删除" cancelText="取消" onConfirm={() => onDelete(t)}>
            <Tooltip title="删除">
              <Button type="text" size="small" danger icon={<DeleteOutlined />} />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  // ---- 看板视图 ----
  function KanbanCard({ task }: { task: TaskRow }) {
    return (
      <div
        style={{
          background: "#fff",
          borderRadius: 10,
          border: "1px solid #f0f0f0",
          padding: "10px 12px",
          cursor: "pointer",
          transition: "box-shadow .2s, border-color .2s",
          display: "grid",
          gap: 6,
        }}
        onClick={() => openEdit(task)}
        onMouseEnter={(e) => {
          e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.08)";
          e.currentTarget.style.borderColor = "#d9d9d9";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.boxShadow = "none";
          e.currentTarget.style.borderColor = "#f0f0f0";
        }}
      >
        <div style={{ fontWeight: 500, fontSize: 13, color: task.status === "done" ? "#8c8c8c" : "inherit" }}>
          {task.status === "done" && <span style={{ marginRight: 4 }}>✓</span>}
          {task.title}
        </div>
        {task.project_name && (
          <Space size={4}>
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                display: "inline-block",
                background: task.project_color || "#1677ff",
              }}
            />
            <span style={{ fontSize: 11, color: "#8c8c8c" }}>{task.project_name}</span>
          </Space>
        )}
        <Space size={4} wrap>
          <Tag
            style={{ fontSize: 10, margin: 0, borderRadius: 4, padding: "0 4px", lineHeight: "16px" }}
            color={PRIORITY_META[task.priority].color}
          >
            {PRIORITY_META[task.priority].label}
          </Tag>
          {task.period && (
            <Tag
              style={{ fontSize: 10, margin: 0, borderRadius: 4, padding: "0 4px", lineHeight: "16px" }}
              color={PERIOD_META[task.period].color}
            >
              {PERIOD_META[task.period].label}
            </Tag>
          )}
          {(task.start_date || task.due_date) && (
            <span style={{ fontSize: 11, color: "#8c8c8c" }}>
              <FieldTimeOutlined /> {task.start_date ? task.start_date : "…"} ~ {task.due_date ? task.due_date : "…"}
            </span>
          )}
        </Space>
      </div>
    );
  }

  function KanbanColumn({ status }: { status: TaskStatus }) {
    const m = STATUS_META[status];
    const colTasks = filtered.filter((t) => t.status === status);
    const otherStatuses = STATUS_ORDER.filter((s) => s !== status);
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          minWidth: 240,
          flex: 1,
          background: m.bg,
          borderRadius: 12,
          border: `1px solid ${m.border}`,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "10px 14px",
            fontWeight: 600,
            fontSize: 14,
            color: m.color,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderBottom: `1px solid ${m.border}`,
          }}
        >
          <span>{m.label}</span>
          <span
            style={{
              background: m.color,
              color: "#fff",
              borderRadius: 10,
              fontSize: 11,
              padding: "1px 8px",
              minWidth: 20,
              textAlign: "center",
            }}
          >
            {colTasks.length}
          </span>
        </div>
        <div style={{ display: "grid", gap: 8, padding: 10 }}>
          {colTasks.map((t) => (
            <KanbanCard key={t.id} task={t} />
          ))}
          {colTasks.length === 0 && (
            <div style={{ textAlign: "center", color: "#bfbfbf", fontSize: 12, padding: "20px 0" }}>
              暂无日常任务
            </div>
          )}
        </div>
      </div>
    );
  }

  // ---- 项目筛选条 ----
  const projectOptions = [
    { label: "全部", value: "all", color: "#595959" },
    ...projects.map((p) => ({
      label: p.name,
      value: String(p.id),
      color: p.color || "#1677ff",
    })),
  ];

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* 工具栏 */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {projectOptions.map((opt) => {
            const active = projectId === opt.value;
            return (
              <div
                key={opt.value}
                onClick={() => setProjectId(opt.value)}
                style={{
                  cursor: "pointer",
                  padding: "4px 14px",
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: active ? 600 : 400,
                  color: active ? "#fff" : opt.color,
                  background: active ? opt.color : "transparent",
                  border: `1px solid ${active ? opt.color : "#e8e8e8"}`,
                  transition: "all .2s",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                {!active && (
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: opt.color,
                      display: "inline-block",
                    }}
                  />
                )}
                {opt.label}
              </div>
            );
          })}
        </div>
        <Space>
          <Segmented
            value={view}
            onChange={(v) => setView(v as "list" | "kanban")}
            options={[
              { label: "看板", value: "kanban", icon: <AppstoreOutlined /> },
              { label: "列表", value: "list", icon: <UnorderedListOutlined /> },
            ]}
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新建日常任务
          </Button>
        </Space>
      </div>

      {/* 视图区域 */}
      {view === "list" ? (
        <Table
          rowKey="id"
          columns={columns}
          dataSource={filtered}
          pagination={{ pageSize: 50, hideOnSinglePage: true }}
          size="middle"
          style={{ borderRadius: 12, overflow: "hidden" }}
        />
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          {STATUS_ORDER.map((status) => (
            <KanbanColumn key={status} status={status} />
          ))}
        </div>
      )}

      {/* 任务表单 */}
      <Modal
        title={editTask ? "编辑日常任务" : "新建日常任务"}
        open={formOpen}
        onCancel={() => setFormOpen(false)}
        footer={null}
        width={520}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={onSubmit}
          requiredMark={false}
          onValuesChange={(changed) => {
            // 切换任务周期时清空起止值，避免日期/时间格式残留
            if ("period" in changed) {
              form.setFieldsValue({ startDate: undefined, dueDate: undefined });
            }
          }}
        >
          <Form.Item
            name="title"
            label="任务标题"
            rules={[{ required: true, message: "请输入任务标题" }]}
          >
            <Input placeholder="这周要做什么…" />
          </Form.Item>
          <Space style={{ width: "100%" }} size={12}>
            <Form.Item name="projectId" label="项目" style={{ flex: 1 }}>
              <Select
                allowClear
                placeholder="选择项目（可选）"
                options={projects.map((p) => ({
                  label: p.name,
                  value: p.id,
                }))}
                style={{ width: 200 }}
              />
            </Form.Item>
            <Form.Item name="status" label="状态">
              <Select
                style={{ width: 120 }}
                options={STATUS_ORDER.map((s) => ({
                  label: STATUS_META[s].label,
                  value: s,
                }))}
              />
            </Form.Item>
            <Form.Item name="priority" label="优先级">
              <Select
                style={{ width: 120 }}
                options={(Object.keys(PRIORITY_META) as TaskPriority[]).map((p) => ({
                  label: PRIORITY_META[p].label,
                  value: p,
                }))}
              />
            </Form.Item>
          </Space>
          <Form.Item name="period" label="任务周期">
            <Segmented
              options={[
                { label: "不限", value: "" },
                ...PERIOD_ORDER.map((p) => ({
                  label: PERIOD_META[p].label,
                  value: p,
                })),
              ]}
            />
          </Form.Item>
          <Space style={{ width: "100%" }} size={12}>
            <Form.Item name="startDate" label={isDaily ? "开始时间" : "开始日期"}>
              {isDaily
                ? <Input type="time" style={{ width: 140 }} />
                : <Input type="date" style={{ width: 200 }} />}
            </Form.Item>
            <Form.Item name="dueDate" label={isDaily ? "截止时间" : "截止日期"}>
              {isDaily
                ? <Input type="time" style={{ width: 140 }} />
                : <Input type="date" style={{ width: 200 }} />}
            </Form.Item>
          </Space>
          <Form.Item name="notes" label="备注">
            <Input.TextArea rows={3} placeholder="补充说明…" />
          </Form.Item>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Button onClick={() => setFormOpen(false)}>取消</Button>
            <Button type="primary" htmlType="submit" loading={busy}>
              {editTask ? "保存" : "创建"}
            </Button>
          </div>
        </Form>
      </Modal>
    </div>
  );
}
