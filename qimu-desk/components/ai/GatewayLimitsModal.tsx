"use client";
import { useState } from "react";
import { Alert, App, Form, InputNumber, Modal } from "antd";

type Limits = { max_input_tokens: number; max_output_tokens: number; timeout_seconds: number };
export default function GatewayLimitsModal({ gateway, onClose, onSaved }: {
  gateway: { id: number; name: string; model: string } & Partial<Limits>;
  onClose: () => void; onSaved: () => Promise<void>;
}) {
  const [form] = Form.useForm<Limits>();
  const [saving, setSaving] = useState(false);
  const { message } = App.useApp();
  async function save() {
    const values = await form.validateFields().catch(() => null);
    if (!values) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/ai/gateways/${gateway.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "保存失败");
      await onSaved(); message.success("模型参数已保存，下次请求生效"); onClose();
    } catch (e) { message.error((e as Error).message); } finally { setSaving(false); }
  }
  return <Modal open title={`模型输入输出 · ${gateway.name}`} onCancel={() => !saving && onClose()} onOk={() => void save()} confirmLoading={saving} okText="保存参数" cancelText="取消" cancelButtonProps={{ disabled: saving }} mask={{ closable: !saving }} keyboard={!saving}>
    <Alert type="info" showIcon title={gateway.model} description="0 表示自动。输入按文本保守估算，包含历史消息、知识引用和工具定义；超过上限会提示，不会默默截断。输出预算包含模型思考内容。" style={{ marginBottom: 20 }} />
    <Form form={form} layout="vertical" initialValues={{ max_input_tokens: gateway.max_input_tokens || 0, max_output_tokens: gateway.max_output_tokens || 0, timeout_seconds: gateway.timeout_seconds || 0 }} disabled={saving}>
      <Form.Item name="max_input_tokens" label="输入上下文上限（估算 tokens）" extra="0：不增加本地输入限制，仍受模型自身上下文窗口限制。" rules={[{ required: true, type: "integer", min: 0, max: 2000000 }]}><InputNumber min={0} max={2000000} precision={0} style={{ width: "100%" }} /></Form.Item>
      <Form.Item name="max_output_tokens" label="最大输出 tokens" extra="0：MiniMax 自动使用 16384；其他模型沿用场景默认值。手动填写后优先使用该值。" rules={[{ required: true, type: "integer", min: 0, max: 262144 }]}><InputNumber min={0} max={262144} precision={0} style={{ width: "100%" }} /></Form.Item>
      <Form.Item name="timeout_seconds" label="请求超时（秒）" extra="0：MiniMax 自动使用 240 秒；其他模型沿用场景默认值。" rules={[{ required: true, type: "integer", min: 0, max: 600 }]}><InputNumber min={0} max={600} precision={0} style={{ width: "100%" }} /></Form.Item>
    </Form>
  </Modal>;
}
