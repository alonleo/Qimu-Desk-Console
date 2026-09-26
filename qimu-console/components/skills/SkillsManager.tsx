"use client";

import { useState, type Key } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag, Typography, message } from "antd";
import { DeleteOutlined, EditOutlined, PlusOutlined, RobotOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import YAML from "yaml";
import BatchBar, { batchRequest } from "../batch/BatchBar";

export type SkillItem = {
  id: number;
  name: string;
  type: "shell" | "prompt" | "http";
  displayName?: string;
  description?: string;
  color?: string;
  params?: unknown[];
  config?: Record<string, unknown>;
  source?: string;
  run_count: number;
  last_run_status: string | null;
  last_run_at: string | null;
};

export type SkillRunRow = {
  id: number;
  skill_id: number;
  skill_name: string;
  status: string;
  error: string | null;
  duration_ms: number | null;
  triggered_by: string;
  started_at: string;
  finished_at: string | null;
};

const TYPE_META: Record<SkillItem["type"], { label: string; color: string; configExample: string }> = {
  shell: {
    label: "Shell 脚本",
    color: "green",
    configExample: `# Shell 技能配置
command: echo Hello, {{name}}!
timeout: 10`,
  },
  prompt: {
    label: "提示词",
    color: "purple",
    configExample: `# 提示词技能配置（template 支持 {{参数}} 占位）
template: |
  请为「{{topic}}」写一段总结。`,
  },
  http: {
    label: "HTTP 接口",
    color: "geekblue",
    configExample: `# HTTP 技能配置
method: GET
url: "{{baseUrl}}/api/health"
timeout: 10`,
  },
};

const PARAMS_EXAMPLE = `# 参数定义（可选），每项：name / label / required / default / description
- name: name
  label: 名字
  required: false
  default: World`;

/** 「AI 生成」来源 Tag：仅 source==='ai' 显示，其余不打扰手动条目 */
const AiTag = ({ source }: { source?: string }) =>
  source === "ai" ? (
    <Tag color="geekblue" icon={<RobotOutlined />}>
      AI 生成
    </Tag>
  ) : null;

type FormValues = {
  name: string;
  type: SkillItem["type"];
  displayName?: string;
  description?: string;
  color: string;
  paramsText?: string;
  configText: string;
};

function parseYamlList(text: string, field: string): unknown[] {
  if (!text.trim()) return [];
  const v = YAML.parse(text);
  if (!Array.isArray(v)) throw new Error(`${field} 必须是 YAML 数组（以 - 开头）`);
  return v;
}

function parseYamlMap(text: string, field: string): Record<string, unknown> {
  if (!text.trim()) throw new Error(`请填写${field}`);
  const v = YAML.parse(text);
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error(`${field} 必须是 YAML 对象`);
  return v as Record<string, unknown>;
}

export default function SkillsManager({ skills, runs }: { skills: SkillItem[]; runs: SkillRunRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<SkillItem | null>(null);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<FormValues>();
  const [selectedType, setSelectedType] = useState<SkillItem["type"]>("shell");
  const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([]);

  function clearSelection() {
    setSelectedRowKeys([]);
  }

  async function onBatchUpdate(patch: Record<string, unknown>) {
    const ok = await batchRequest("/api/skills/batch-update", { ids: selectedRowKeys, data: patch }, "updated", "批量修改");
    if (ok) {
      clearSelection();
      router.refresh();
    }
    return ok;
  }

  async function onBatchDelete() {
    const ok = await batchRequest("/api/skills/batch-delete", { ids: selectedRowKeys }, "deleted", "批量删除");
    if (ok) {
      clearSelection();
      router.refresh();
    }
    return ok;
  }

  async function onBatchCreate(items: Record<string, unknown>[]) {
    const ok = await batchRequest("/api/skills/batch-create", { items }, "created", "批量新增");
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
    const t = "shell";
    setSelectedType(t);
    form.setFieldsValue({ type: t, color: "#52c41a", paramsText: "", configText: "" });
    setOpen(true);
  }

  function openEdit(s: SkillItem) {
    setEditing(s);
    const t = s.type;
    setSelectedType(t);
    const execCfg = s.config && typeof s.config === "object" ? (s.config[t] as unknown) : {};
    form.setFieldsValue({
      name: s.name,
      type: t,
      displayName: s.displayName || s.name,
      description: s.description ?? "",
      color: s.color || "#8c8c8c",
      paramsText: s.params?.length ? YAML.stringify(s.params) : "",
      configText: execCfg ? YAML.stringify(execCfg) : "",
    });
    setOpen(true);
  }

  async function onSubmit(values: FormValues) {
    let params: unknown[];
    let config: Record<string, unknown>;
    try {
      params = parseYamlList(values.paramsText ?? "", "参数定义");
      config = parseYamlMap(values.configText, "执行配置");
    } catch (e) {
      message.error((e as Error).message);
      return;
    }
    const body = {
      name: values.name.trim(),
      type: values.type,
      displayName: values.displayName?.trim() || values.name.trim(),
      description: values.description?.trim() ?? "",
      color: values.color,
      params,
      config,
    };
    const ok = editing
      ? await call(`/api/skills/${editing.id}`, "PATCH", body)
      : await call("/api/skills", "POST", body);
    if (ok) {
      setOpen(false);
      setEditing(null);
    }
  }

  const skillColumns: ColumnsType<SkillItem> = [
    { title: "编号", dataIndex: "id", width: 70 },
    {
      title: "技能名称",
      dataIndex: "name",
      render: (_, s) => (
        <div>
          <span style={{ fontWeight: 500 }}>{s.displayName || s.name}</span>
          <div style={{ fontSize: 12, color: "#8c8c8c" }}>{s.name}</div>
        </div>
      ),
    },
    {
      title: "类型",
      dataIndex: "type",
      width: 150,
      render: (v: SkillItem["type"], s: SkillItem) => (
        <Space size={4}>
          <Tag color={TYPE_META[v]?.color ?? "default"}>{TYPE_META[v]?.label ?? v}</Tag>
          <AiTag source={s.source} />
        </Space>
      ),
    },
    {
      title: "描述",
      dataIndex: "description",
      ellipsis: true,
      render: (v: string) => v || <span style={{ color: "#bfbfbf" }}>—</span>,
    },
    { title: "运行次数", dataIndex: "run_count", width: 90, render: (v: number) => <Tag color="geekblue">{v}</Tag> },
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
      title: "最近结果",
      dataIndex: "last_run_status",
      width: 100,
      render: (v: string | null) =>
        v === "success" ? <Tag color="success">成功</Tag> : v === "failed" ? <Tag color="error">失败</Tag> : <Tag>未运行</Tag>,
    },
    {
      title: "最近执行",
      dataIndex: "last_run_at",
      width: 165,
      render: (v: string | null) => <span style={{ color: "#8c8c8c", fontSize: 12 }}>{v?.slice(0, 16) ?? "—"}</span>,
    },
    {
      title: "操作",
      key: "actions",
      width: 170,
      render: (_, s) => (
        <Space>
          <Button type="primary" ghost size="small" icon={<EditOutlined />} onClick={() => openEdit(s)}>
            修改
          </Button>
          <Popconfirm title="删除该技能？" description="其运行记录将一并删除，不可恢复。" okText="确定" cancelText="取消" onConfirm={() => call(`/api/skills/${s.id}`, "DELETE")}>
            <Button danger size="small" icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const runColumns: ColumnsType<SkillRunRow> = [
    { title: "编号", dataIndex: "id", width: 70 },
    { title: "技能", dataIndex: "skill_name" },
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
      title: "执行时间",
      dataIndex: "started_at",
      width: 165,
      render: (v: string) => <span style={{ color: "#8c8c8c", fontSize: 12 }}>{v?.slice(0, 19)}</span>,
    },
    {
      title: "错误信息",
      dataIndex: "error",
      ellipsis: true,
      render: (v: string | null) =>
        v ? (
          <Typography.Text type="danger" style={{ fontSize: 12 }}>
            {v}
          </Typography.Text>
        ) : (
          <span style={{ color: "#bfbfbf" }}>—</span>
        ),
    },
  ];

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Card
        title={
          <span>
            技能列表
            <Tag style={{ marginLeft: 10 }} color="blue">
              {skills.length}
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
            { key: "color", label: "颜色", type: "text", placeholder: "#52c41a" },
          ]}
          onBatchUpdate={onBatchUpdate}
          onBatchDelete={onBatchDelete}
          deleteDescription="选中的技能及其运行记录将一并删除，不可恢复。"
          onBatchCreate={onBatchCreate}
          createExample={`[
  {
    "name": "hello",
    "type": "prompt",
    "displayName": "打个招呼",
    "config": { "template": "你好，{{name}}！" },
    "params": [{ "name": "name", "label": "名字" }]
  }
]`}
        />
        <Table
          rowKey="id"
          size="middle"
          columns={skillColumns}
          dataSource={skills}
          rowSelection={{ selectedRowKeys, onChange: (keys) => setSelectedRowKeys(keys) }}
          pagination={false}
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
        title={editing ? `修改技能：${editing.name}` : "新增技能"}
        open={open}
        onCancel={() => {
          setOpen(false);
          setEditing(null);
        }}
        footer={null}
        width={720}
      >
        <Form form={form} layout="vertical" onFinish={onSubmit} requiredMark={false}>
          <Space size={16} style={{ display: "flex" }} align="start">
            <Form.Item
              name="name"
              label="技能标识"
              style={{ minWidth: 220 }}
              rules={[
                { required: true, message: "请输入技能标识" },
                { pattern: /^[a-z0-9][a-z0-9-]*$/, message: "小写字母、数字或短横线" },
              ]}
            >
              <Input placeholder="如 hello" />
            </Form.Item>
            <Form.Item
              name="type"
              label="类型"
              style={{ minWidth: 160 }}
              rules={[{ required: true, message: "请选择类型" }]}
            >
              <Select
                options={(Object.keys(TYPE_META) as SkillItem["type"][]).map((t) => ({ value: t, label: TYPE_META[t].label }))}
                onChange={(t: SkillItem["type"]) => {
                  setSelectedType(t);
                  form.setFieldValue("configText", "");
                  form.setFieldValue("color", t === "shell" ? "#52c41a" : t === "prompt" ? "#722ed1" : "#13c2c2");
                }}
              />
            </Form.Item>
            <Form.Item name="displayName" label="显示名称" style={{ minWidth: 180 }}>
              <Input placeholder="如 打个招呼" />
            </Form.Item>
            <Form.Item name="color" label="颜色" style={{ minWidth: 110 }}>
              <input type="color" style={{ width: 60, height: 32, padding: 2, border: "1px solid #d9d9d9", borderRadius: 6, cursor: "pointer" }} />
            </Form.Item>
          </Space>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={2} placeholder="这个技能是做什么的" />
          </Form.Item>
          <Form.Item name="paramsText" label="参数定义（YAML，可选）">
            <Input.TextArea rows={4} style={{ fontFamily: "monospace", fontSize: 12 }} placeholder={PARAMS_EXAMPLE} />
          </Form.Item>
          <Form.Item
            name="configText"
            label={`执行配置（YAML，${TYPE_META[selectedType]?.label ?? ""}）`}
            rules={[{ required: true, message: "请填写执行配置" }]}
          >
            <Input.TextArea rows={7} style={{ fontFamily: "monospace", fontSize: 12 }} placeholder={TYPE_META[selectedType]?.configExample} />
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
