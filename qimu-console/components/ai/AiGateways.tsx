"use client";

import { useState, type Key } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { Button, Card, Form, Input, InputNumber, Modal, Popconfirm, Space, Switch, Table, Tag, Typography, message } from "antd";
import { ApiOutlined, DeleteOutlined, EditOutlined, PlusOutlined, StarOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import type { GatewayTestResult } from "./GatewayTestModal";
import BatchBar, { batchRequest } from "../batch/BatchBar";

/** 测试结果弹窗懒加载：react-markdown 等依赖不进首屏包 */
const GatewayTestModal = dynamic(() => import("./GatewayTestModal"), { ssr: false });

export type AiGatewayDto = {
  id: number;
  name: string;
  provider: string;
  base_url: string;
  api_key: string;
  model: string;
  temperature: number;
  max_input_tokens: number;
  max_output_tokens: number;
  timeout_seconds: number;
  enabled: boolean;
  is_default: boolean;
  updated_at: string | null;
};

type FormValues = {
  name: string;
  provider: string;
  base_url: string;
  api_key?: string;
  model: string;
  temperature: number;
  max_input_tokens: number;
  max_output_tokens: number;
  timeout_seconds: number;
  enabled: boolean;
};

export default function AiGateways({ gateways }: { gateways: AiGatewayDto[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [editing, setEditing] = useState<AiGatewayDto | null>(null);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<FormValues>();
  const [testResult, setTestResult] = useState<GatewayTestResult | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([]);

  function clearSelection() {
    setSelectedRowKeys([]);
  }

  async function onBatchUpdate(patch: Record<string, unknown>) {
    const ok = await batchRequest("/api/ai/gateways/batch-update", { ids: selectedRowKeys, data: patch }, "updated", "批量修改");
    if (ok) {
      clearSelection();
      router.refresh();
    }
    return ok;
  }

  async function onBatchDelete() {
    const ok = await batchRequest("/api/ai/gateways/batch-delete", { ids: selectedRowKeys }, "deleted", "批量删除");
    if (ok) {
      clearSelection();
      router.refresh();
    }
    return ok;
  }

  async function onBatchCreate(items: Record<string, unknown>[]) {
    const ok = await batchRequest("/api/ai/gateways/batch-create", { items }, "created", "批量新增");
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

  async function onTest(g: AiGatewayDto) {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(`/api/ai/gateways/${g.id}/test`, { method: "POST", headers: { "Content-Type": "application/json" } });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; reply?: string; error?: string };
      setTestResult({ name: g.name, ok: !!data.ok, reply: data.reply, error: data.error });
      if (data.ok) message.success("连接正常");
      else message.error(data.error ?? "连接失败");
    } catch {
      message.error("网络错误，请重试");
    } finally {
      setTesting(false);
    }
  }

  function openCreate() {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ provider: "openai-compatible", temperature: 0.7, max_input_tokens: 0, max_output_tokens: 0, timeout_seconds: 0, enabled: false, base_url: "", model: "" });
    setOpen(true);
  }

  function openEdit(g: AiGatewayDto) {
    setEditing(g);
    form.setFieldsValue({
      name: g.name,
      provider: g.provider,
      base_url: g.base_url,
      api_key: g.api_key || "",
      model: g.model,
      temperature: g.temperature,
      max_input_tokens: g.max_input_tokens || 0,
      max_output_tokens: g.max_output_tokens || 0,
      timeout_seconds: g.timeout_seconds || 0,
      enabled: g.enabled,
    });
    setOpen(true);
  }

  async function onSubmit(values: FormValues) {
    const body = {
      name: values.name.trim(),
      provider: values.provider.trim() || "openai-compatible",
      base_url: values.base_url.trim(),
      api_key: values.api_key,
      model: values.model.trim(),
      temperature: values.temperature,
      max_input_tokens: values.max_input_tokens || 0,
      max_output_tokens: values.max_output_tokens || 0,
      timeout_seconds: values.timeout_seconds || 0,
      enabled: values.enabled,
    };
    const ok = editing
      ? await call(`/api/ai/gateways/${editing.id}`, "PATCH", body)
      : await call("/api/ai/gateways", "POST", body);
    if (ok) {
      setOpen(false);
      setEditing(null);
    }
  }

  const columns: ColumnsType<AiGatewayDto> = [
    { title: "编号", dataIndex: "id", width: 60 },
    {
      title: "网关名称",
      dataIndex: "name",
      width: 200,
      render: (_, g) => (
        <Space size={6} wrap>
          <span style={{ fontWeight: 500 }}>{g.name}</span>
          {g.is_default ? <Tag color="gold">默认</Tag> : null}
        </Space>
      ),
    },
    { title: "服务商", dataIndex: "provider", width: 140, render: (v: string) => <Tag>{v}</Tag> },
    {
      title: "模型",
      dataIndex: "model",
      width: 140,
      render: (v: string) => v || <span style={{ color: "#bfbfbf" }}>—</span>,
    },
    { title: "Base URL", dataIndex: "base_url", width: 220, ellipsis: true, render: (v: string) => v || <span style={{ color: "#bfbfbf" }}>—</span> },
    {
      title: "状态",
      dataIndex: "enabled",
      width: 90,
      render: (v: boolean) => (v ? <Tag color="success">启用</Tag> : <Tag color="default">停用</Tag>),
    },
    {
      title: "更新时间",
      dataIndex: "updated_at",
      width: 150,
      render: (v: string | null) => <span style={{ color: "#8c8c8c", fontSize: 12 }}>{v?.slice(0, 16) ?? "—"}</span>,
    },
    {
      title: "操作",
      key: "actions",
      width: 260,
      fixed: "right",
      render: (_, g) => (
        <Space>
          <Button type="primary" ghost size="small" icon={<ApiOutlined />} loading={testing} onClick={() => onTest(g)}>
            测试
          </Button>
          <Button type="primary" ghost size="small" icon={<EditOutlined />} onClick={() => openEdit(g)}>
            修改
          </Button>
          {!g.is_default ? (
            <Popconfirm title="设为默认网关？" description="前台 AI 工作平台将使用该网关。" okText="确定" cancelText="取消" onConfirm={() => call(`/api/ai/gateways/${g.id}`, "PATCH", { is_default: true })}>
              <Button size="small" icon={<StarOutlined />}>
                设为默认
              </Button>
            </Popconfirm>
          ) : null}
          <Popconfirm
            title="删除该网关？"
            description={gateways.length <= 1 ? "至少保留一个 AI 网关" : "默认网关被删后将自动指定其他网关。"}
            okText="确定"
            cancelText="取消"
            disabled={gateways.length <= 1}
            onConfirm={() => call(`/api/ai/gateways/${g.id}`, "DELETE")}
          >
            <Button danger size="small" icon={<DeleteOutlined />} disabled={gateways.length <= 1}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Card
        title={
          <span>
            AI 网关列表
            <Tag style={{ marginLeft: 10 }} color="blue">
              {gateways.length}
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
            { key: "enabled", label: "启用状态", type: "switch", checkedText: "启用", uncheckedText: "停用" },
            { key: "temperature", label: "Temperature", type: "number", min: 0, max: 2, step: 0.1 },
            { key: "max_input_tokens", label: "输入上限（估算 tokens，0 自动）", type: "number", min: 0, max: 2000000, step: 1 },
            { key: "max_output_tokens", label: "最大输出 tokens（0 自动）", type: "number", min: 0, max: 262144, step: 1 },
            { key: "timeout_seconds", label: "超时秒数（0 自动）", type: "number", min: 0, max: 600, step: 1 },
            { key: "provider", label: "服务商", type: "text", placeholder: "openai-compatible" },
            { key: "model", label: "模型", type: "text", placeholder: "如 deepseek-chat" },
            { key: "base_url", label: "Base URL", type: "text", placeholder: "https://api.example.com/v1" },
          ]}
          onBatchUpdate={onBatchUpdate}
          onBatchDelete={onBatchDelete}
          deleteDescription="选中的网关将全部删除；系统至少保留一个网关，默认网关删除后自动移交。"
          onBatchCreate={onBatchCreate}
          createExample={`[
  { "name": "备用网关", "base_url": "https://api.example.com/v1", "api_key": "sk-xxx", "model": "deepseek-chat" },
  { "name": "本地网关", "base_url": "http://127.0.0.1:8000/v1", "model": "qwen2.5" }
]`}
        />
        <Table
          rowKey="id"
          size="middle"
          columns={columns}
          dataSource={gateways}
          rowSelection={{ selectedRowKeys, onChange: (keys) => setSelectedRowKeys(keys) }}
          pagination={false}
          scroll={{ x: 1100 }}
        />
      </Card>

      <Card title="说明" styles={{ body: { paddingTop: 12 } }}>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 4 }}>
          1. 支持维护多个 AI 网关（OpenAI 兼容接口），带「默认」标记的网关是前台 AI 工作平台对话 / 技能 / 工作流 llm 步骤实际调用的那个。
        </Typography.Paragraph>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 4 }}>
          2. 新增的网关默认不启用；启用前请填齐 Base URL / API Key / 模型，可用「测试」按钮验证连通性。
        </Typography.Paragraph>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          3. 密钥仅打码显示最后 4 位；编辑时保持打码值提交不会覆盖已保存的密钥。
        </Typography.Paragraph>
      </Card>

      <Modal
        title={editing ? `修改网关：${editing.name}` : "新增 AI 网关"}
        open={open}
        onCancel={() => {
          setOpen(false);
          setEditing(null);
        }}
        footer={null}
        width={640}
      >
        <Form form={form} layout="vertical" onFinish={onSubmit} requiredMark={false}>
          <Space size={16} style={{ display: "flex" }}>
            <Form.Item name="name" label="网关名称" style={{ minWidth: 200 }} rules={[{ required: true, message: "请输入网关名称" }]}>
              <Input placeholder="如 默认网关 / 备用网关" />
            </Form.Item>
            <Form.Item name="provider" label="服务商" style={{ minWidth: 220 }} initialValue="openai-compatible">
              <Input placeholder="openai-compatible" />
            </Form.Item>
          </Space>
          <Form.Item name="base_url" label="Base URL" rules={[{ required: true, message: "请输入网关地址" }]}>
            <Input placeholder="https://api.example.com/v1（自动拼接 /chat/completions）" />
          </Form.Item>
          <Form.Item
            name="api_key"
            label="API Key"
            extra={editing && editing.api_key ? `已保存密钥：${editing.api_key}，重新输入可覆盖` : undefined}
          >
            <Input.Password placeholder={editing && editing.api_key ? editing.api_key : "sk-..."} />
          </Form.Item>
          <Space size={16} style={{ display: "flex" }}>
            <Form.Item name="model" label="模型" style={{ minWidth: 260 }} rules={[{ required: true, message: "请输入模型名称" }]}>
              <Input placeholder="如 gpt-4o-mini / deepseek-chat" />
            </Form.Item>
            <Form.Item name="temperature" label="Temperature" initialValue={0.7}>
              <InputNumber min={0} max={2} step={0.1} style={{ width: 130 }} />
            </Form.Item>
            <Form.Item name="enabled" label="启用" valuePropName="checked" initialValue={false}>
              <Switch checkedChildren="启用" unCheckedChildren="停用" />
            </Form.Item>
          </Space>
          <Typography.Paragraph type="secondary">0 表示自动；输入采用保守文本估算，超过预算会提示，不会默默截断。最大输出包含思考内容。</Typography.Paragraph>
          <Form.Item name="max_input_tokens" label="输入上下文上限（估算 tokens）" initialValue={0} rules={[{ required: true, type: "integer", min: 0, max: 2000000 }]}><InputNumber min={0} max={2000000} precision={0} style={{ width: "100%" }} /></Form.Item>
          <Form.Item name="max_output_tokens" label="最大输出 tokens" initialValue={0} extra="MiniMax 自动值为 16384；手动填写后优先使用该值。" rules={[{ required: true, type: "integer", min: 0, max: 262144 }]}><InputNumber min={0} max={262144} precision={0} style={{ width: "100%" }} /></Form.Item>
          <Form.Item name="timeout_seconds" label="请求超时（秒）" initialValue={0} extra="MiniMax 自动值为 240 秒。" rules={[{ required: true, type: "integer", min: 0, max: 600 }]}><InputNumber min={0} max={600} precision={0} style={{ width: "100%" }} /></Form.Item>
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

      <GatewayTestModal result={testResult} onClose={() => setTestResult(null)} />
    </div>
  );
}
