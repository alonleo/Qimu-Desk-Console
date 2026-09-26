"use client";

import { useState, type Key } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Form, Input, Modal, Popconfirm, Space, Table, Tag, Typography, message } from "antd";
import { DeleteOutlined, EditOutlined, PlusOutlined, RobotOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import YAML from "yaml";
import BatchBar, { batchRequest } from "../batch/BatchBar";

export type WorkflowItem = {
  id: number;
  name: string;
  displayName?: string;
  description?: string;
  color?: string;
  params?: unknown[];
  steps?: unknown[];
  version: number | null;
  source?: string;
  created_at: string | null;
  updated_at: string | null;
};

export type RunSummary = {
  id: number;
  workflow_name: string;
  status: string;
  duration_ms: number | null;
  triggered_by: string;
  started_at: string;
};

type StepInfo = { name?: string; title?: string; status?: string; output?: string; error?: string; [k: string]: unknown };

type FormValues = {
  name: string;
  displayName?: string;
  description?: string;
  color: string;
  paramsText?: string;
  stepsText: string;
};

const SAMPLE_STEPS = `# 步骤是 YAML 数组，每步需包含 id、name、type。
# 支持类型：shell / http / template / skill / llm
- id: hello
  name: 打个招呼
  type: template
  template:
    content: 你好，{{who}}
`;

const SAMPLE_PARAMS = `# 参数定义（可选），每项：name / label / required / default
- name: who
  label: 称呼
  required: false
  default: 世界
`;

function parseYamlList(text: string, field: string): unknown[] {
  if (!text.trim()) return [];
  const v = YAML.parse(text);
  if (!Array.isArray(v)) throw new Error(`${field} 必须是 YAML 数组（以 - 开头）`);
  return v;
}

/** 「AI 生成」来源 Tag：仅 source==='ai' 显示，其余不打扰手动条目 */
const AiTag = ({ source }: { source?: string }) =>
  source === "ai" ? (
    <Tag color="geekblue" icon={<RobotOutlined />}>
      AI 生成
    </Tag>
  ) : null;

export default function WorkflowsManager({ workflows, runs }: { workflows: WorkflowItem[]; runs: RunSummary[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<WorkflowItem | null>(null);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<FormValues>();
  const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([]);

  function clearSelection() {
    setSelectedRowKeys([]);
  }

  async function onBatchUpdate(patch: Record<string, unknown>) {
    const ok = await batchRequest("/api/workflows/batch-update", { ids: selectedRowKeys, data: patch }, "updated", "批量修改");
    if (ok) {
      clearSelection();
      router.refresh();
    }
    return ok;
  }

  async function onBatchDelete() {
    const ok = await batchRequest("/api/workflows/batch-delete", { ids: selectedRowKeys }, "deleted", "批量删除");
    if (ok) {
      clearSelection();
      router.refresh();
    }
    return ok;
  }

  async function onBatchCreate(items: Record<string, unknown>[]) {
    const ok = await batchRequest("/api/workflows/batch-create", { items }, "created", "批量新增");
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

  function openCreate() {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ color: "#fa8c16", stepsText: "", paramsText: "" });
    setOpen(true);
  }

  function openEdit(w: WorkflowItem) {
    setEditing(w);
    form.setFieldsValue({
      name: w.name,
      displayName: w.displayName || w.name,
      description: w.description ?? "",
      color: w.color || "#fa8c16",
      paramsText: w.params?.length ? YAML.stringify(w.params) : "",
      stepsText: YAML.stringify(w.steps ?? []),
    });
    setOpen(true);
  }

  async function onSubmit(values: FormValues) {
    let params: unknown[];
    let steps: unknown[];
    try {
      params = parseYamlList(values.paramsText ?? "", "参数定义");
      steps = parseYamlList(values.stepsText, "步骤定义");
    } catch (e) {
      message.error((e as Error).message);
      return;
    }
    if (!steps.length) {
      message.error("至少需要定义一个步骤");
      return;
    }
    const body = {
      name: values.name.trim(),
      displayName: values.displayName?.trim() || values.name.trim(),
      description: values.description?.trim() ?? "",
      color: values.color,
      params,
      steps,
    };
    const ok = editing
      ? await call(`/api/workflows/${editing.id}`, "PATCH", body)
      : await call("/api/workflows", "POST", body);
    if (ok) {
      setOpen(false);
      setEditing(null);
    }
  }

  const columns: ColumnsType<WorkflowItem> = [
    { title: "编号", dataIndex: "id", width: 70 },
    {
      title: "工作流名称",
      dataIndex: "name",
      render: (_, w) => (
        <div>
          <Space size={4}>
            <span style={{ fontWeight: 500 }}>{w.displayName || w.name}</span>
            <AiTag source={w.source} />
          </Space>
          <div style={{ fontSize: 12, color: "#8c8c8c" }}>{w.name}</div>
        </div>
      ),
    },
    {
      title: "描述",
      dataIndex: "description",
      ellipsis: true,
      render: (v: string) => v || <span style={{ color: "#bfbfbf" }}>—</span>,
    },
    { title: "版本", dataIndex: "version", width: 80, render: (v: number | null) => (v == null ? "—" : `v${v}`) },
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
      title: "更新时间",
      dataIndex: "updated_at",
      width: 165,
      render: (v: string | null) => <span style={{ color: "#8c8c8c", fontSize: 12 }}>{v?.slice(0, 16) ?? "—"}</span>,
    },
    {
      title: "操作",
      key: "actions",
      width: 170,
      render: (_, w) => (
        <Space>
          <Button type="primary" ghost size="small" icon={<EditOutlined />} onClick={() => openEdit(w)}>
            修改
          </Button>
          <Popconfirm title="删除该工作流？" description="其运行记录将一并删除，不可恢复。" okText="确定" cancelText="取消" onConfirm={() => call(`/api/workflows/${w.id}`, "DELETE")}>
            <Button danger size="small" icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const runColumns: ColumnsType<RunSummary> = [
    { title: "编号", dataIndex: "id", width: 70 },
    { title: "工作流", dataIndex: "workflow_name" },
    {
      title: "状态",
      dataIndex: "status",
      width: 90,
      render: (v: string) => (v === "success" ? <Tag color="success">成功</Tag> : <Tag color="error">失败</Tag>),
    },
    {
      title: "耗时",
      dataIndex: "duration_ms",
      width: 100,
      render: (v: number | null) => (v == null ? "—" : `${v} ms`),
    },
    { title: "触发人", dataIndex: "triggered_by", width: 90 },
    {
      title: "开始时间",
      dataIndex: "started_at",
      width: 165,
      render: (v: string) => <span style={{ color: "#8c8c8c", fontSize: 12 }}>{v?.slice(0, 19)}</span>,
    },
  ];

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Card
        title={
          <span>
            工作流列表
            <Tag style={{ marginLeft: 10 }} color="blue">
              {workflows.length}
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
            { key: "displayName", label: "显示名称", type: "text" },
            { key: "description", label: "描述", type: "text" },
            { key: "color", label: "颜色", type: "text", placeholder: "#fa8c16" },
          ]}
          onBatchUpdate={onBatchUpdate}
          onBatchDelete={onBatchDelete}
          deleteDescription="选中的工作流及其运行记录将一并删除，不可恢复。"
          onBatchCreate={onBatchCreate}
          createExample={`[
  {
    "name": "daily-report",
    "displayName": "每日简报",
    "steps": [
      { "id": "hello", "name": "打个招呼", "type": "template", "template": { "content": "你好，{{who}}" } }
    ]
  }
]`}
        />
        <Table
          rowKey="id"
          size="middle"
          columns={columns}
          dataSource={workflows}
          rowSelection={{ selectedRowKeys, onChange: (keys) => setSelectedRowKeys(keys) }}
          pagination={{ pageSize: 10, showTotal: (t) => `共 ${t} 条` }}
        />
      </Card>

      <Card
        title={
          <span>
            运行记录
            <Tag style={{ marginLeft: 10 }} color="blue">
              最近 {runs.length} 条
            </Tag>
          </span>
        }
      >
        <Table rowKey="id" size="middle" columns={runColumns} dataSource={runs} pagination={{ pageSize: 10, showTotal: (t) => `共 ${t} 条` }} />
      </Card>

      <Modal
        title={editing ? `修改工作流：${editing.name}` : "新增工作流"}
        open={open}
        onCancel={() => {
          setOpen(false);
          setEditing(null);
        }}
        footer={null}
        width={760}
      >
        <Form form={form} layout="vertical" onFinish={onSubmit} requiredMark={false}>
          <Space size={16} style={{ display: "flex" }} align="start">
            <Form.Item
              name="name"
              label="工作流标识"
              style={{ minWidth: 240 }}
              rules={[
                { required: true, message: "请输入工作流标识" },
                { pattern: /^[a-z0-9][a-z0-9-]*$/, message: "小写字母、数字或短横线" },
              ]}
            >
              <Input placeholder="如 daily-report" />
            </Form.Item>
            <Form.Item name="displayName" label="显示名称" style={{ minWidth: 240 }}>
              <Input placeholder="如 每日简报" />
            </Form.Item>
            <Form.Item name="color" label="颜色" style={{ minWidth: 120 }}>
              <input type="color" style={{ width: 60, height: 32, padding: 2, border: "1px solid #d9d9d9", borderRadius: 6, cursor: "pointer" }} />
            </Form.Item>
          </Space>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={2} placeholder="这个工作流是做什么的" />
          </Form.Item>
          <Form.Item name="paramsText" label="参数定义（YAML，可选）" extra="每项含 name / label / required / default">
            <Input.TextArea rows={4} style={{ fontFamily: "monospace", fontSize: 12 }} placeholder={SAMPLE_PARAMS} />
          </Form.Item>
          <Form.Item name="stepsText" label="步骤定义（YAML）" rules={[{ required: true, message: "请输入步骤定义" }]}>
            <Input.TextArea rows={10} style={{ fontFamily: "monospace", fontSize: 12 }} placeholder={SAMPLE_STEPS} />
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
