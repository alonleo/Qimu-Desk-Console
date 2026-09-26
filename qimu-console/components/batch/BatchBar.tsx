"use client";

import { useState } from "react";
import { Alert, Button, Form, Input, InputNumber, Modal, Select, Space, Switch, message } from "antd";
import { ClearOutlined, DeleteOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons";

/**
 * 批量接口通用调用：POST JSON + 解析统一响应 {ok, created/updated/deleted, failed, errors}。
 * 返回 true 表示至少成功一条（父组件据此刷新列表、清空选中）。
 */
export async function batchRequest(
  url: string,
  body: Record<string, unknown>,
  okKey: "created" | "updated" | "deleted",
  verbLabel: string
): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || data.error || data.ok === false) {
      message.error(String(data.error ?? "操作失败"));
      return false;
    }
    const okCount = Number(data[okKey] ?? 0);
    const failed = Number(data.failed ?? 0);
    if (failed > 0) {
      const first = (data.errors as { error?: string }[] | undefined)?.[0]?.error;
      message.warning(`${verbLabel}成功 ${okCount} 条，失败 ${failed} 条${first ? `：${first}` : ""}`);
    } else {
      message.success(`${verbLabel}成功 ${okCount} 条`);
    }
    return okCount > 0;
  } catch {
    message.error("网络错误，请重试");
    return false;
  }
}

/**
 * 通用批量操作条（若依风格）：
 * - 无选中行：仅展示「批量新增」按钮（JSON 数组粘贴创建）
 * - 有选中行：Alert 条 + 批量修改 / 批量删除 / 取消选择
 * 写请求由父组件通过回调发起，返回 true 表示成功（弹窗自动关闭，选中态由父组件清理）。
 */

export type BatchField =
  | { key: string; label: string; type: "select"; options: { value: string | number; label: string }[] }
  | { key: string; label: string; type: "text"; placeholder?: string }
  | { key: string; label: string; type: "number"; min?: number; max?: number; step?: number }
  | { key: string; label: string; type: "switch"; checkedText?: string; uncheckedText?: string };

type Props = {
  selectedCount: number;
  onClearSelection: () => void;
  /** 批量修改可选字段；不传或为空则不展示「批量修改」 */
  fields?: BatchField[];
  onBatchUpdate?: (patch: Record<string, unknown>) => Promise<boolean>;
  onBatchDelete?: () => Promise<boolean>;
  deleteDescription?: string;
  onBatchCreate?: (items: Record<string, unknown>[]) => Promise<boolean>;
  createExample?: string;
};

export default function BatchBar({
  selectedCount,
  onClearSelection,
  fields = [],
  onBatchUpdate,
  onBatchDelete,
  deleteDescription = "删除后不可恢复。",
  onBatchCreate,
  createExample,
}: Props) {
  const [updateOpen, setUpdateOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createText, setCreateText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [updateForm] = Form.useForm<{ field?: string; value?: unknown }>();

  const selected = selectedCount > 0;

  async function run(fn: () => Promise<boolean>): Promise<boolean> {
    setSubmitting(true);
    try {
      return await fn();
    } finally {
      setSubmitting(false);
    }
  }

  async function onUpdateSubmit(values: { field?: string; value?: unknown }) {
    if (!onBatchUpdate) return;
    const field = values.field ?? "";
    const def = fields.find((f) => f.key === field);
    if (!def) {
      message.error("请选择字段");
      return;
    }
    const value = values.value;
    if (def?.type !== "switch" && (value === undefined || value === null || value === "")) {
      message.error("请填写新值");
      return;
    }
    const patchValue = def?.type === "switch" ? Boolean(value) : value;
    const ok = await run(() => onBatchUpdate({ [field]: patchValue }));
    if (ok) {
      setUpdateOpen(false);
      updateForm.resetFields();
    }
  }

  function openCreate() {
    setCreateText("");
    setCreateOpen(true);
  }

  async function onCreateSubmit() {
    if (!onBatchCreate) return;
    let items: unknown;
    try {
      items = JSON.parse(createText);
    } catch {
      message.error("JSON 解析失败，请检查格式");
      return;
    }
    if (!Array.isArray(items) || items.length === 0) {
      message.error("需为非空的 JSON 数组");
      return;
    }
    if (items.some((it) => it === null || typeof it !== "object" || Array.isArray(it))) {
      message.error("数组每个元素都必须是对象");
      return;
    }
    const ok = await run(() => onBatchCreate(items as Record<string, unknown>[]));
    if (ok) setCreateOpen(false);
  }

  // useWatch 订阅字段变化：getFieldValue 在渲染期取值不会触发重渲染，选完字段后新值输入框不出现
  const selectedField = Form.useWatch("field", updateForm);
  const activeField = fields.find((f) => f.key === selectedField);

  return (
    <>
      <div style={{ marginBottom: selected ? 16 : 12, display: "flex", justifyContent: "flex-end", gap: 8 }}>
        {selected ? (
          <Alert
            style={{ flex: 1 }}
            type="info"
            showIcon
            message={`已选择 ${selectedCount} 项`}
            action={
              <Space>
                {fields.length > 0 && onBatchUpdate ? (
                  <Button
                    size="small"
                    icon={<EditOutlined />}
                    onClick={() => {
                      updateForm.resetFields();
                      setUpdateOpen(true);
                    }}
                  >
                    批量修改
                  </Button>
                ) : null}
                {onBatchDelete ? (
                  <Button
                    danger
                    size="small"
                    icon={<DeleteOutlined />}
                    onClick={() => {
                      Modal.confirm({
                        title: `批量删除 ${selectedCount} 项？`,
                        content: deleteDescription,
                        okText: "删除",
                        okButtonProps: { danger: true },
                        cancelText: "取消",
                        onOk: () => onBatchDelete(),
                      });
                    }}
                  >
                    批量删除
                  </Button>
                ) : null}
                <Button size="small" type="text" icon={<ClearOutlined />} onClick={onClearSelection}>
                  取消选择
                </Button>
              </Space>
            }
          />
        ) : null}
        {onBatchCreate ? (
          <Button icon={<PlusOutlined />} onClick={openCreate}>
            批量新增
          </Button>
        ) : null}
      </div>

      {/* 批量修改弹窗 */}
      <Modal
        title={`批量修改 ${selectedCount} 项`}
        open={updateOpen}
        onCancel={() => setUpdateOpen(false)}
        footer={null}
        width={480}
      >
        <Form form={updateForm} layout="vertical" onFinish={onUpdateSubmit} requiredMark={false}>
          <Form.Item name="field" label="修改字段" rules={[{ required: true, message: "请选择字段" }]}>
            <Select
              placeholder="选择要修改的字段"
              options={fields.map((f) => ({ value: f.key, label: f.label }))}
              onChange={() => updateForm.setFieldValue("value", undefined)}
            />
          </Form.Item>
          {activeField ? (
            <Form.Item
              name="value"
              label="新值"
              valuePropName={activeField.type === "switch" ? "checked" : "value"}
              rules={[{ required: activeField.type !== "switch", message: "请填写新值" }]}
            >
              {activeField.type === "select" ? (
                <Select options={activeField.options} placeholder="选择新值" />
              ) : activeField.type === "number" ? (
                <InputNumber min={activeField.min} max={activeField.max} step={activeField.step} style={{ width: "100%" }} />
              ) : activeField.type === "switch" ? (
                <Switch checkedChildren={activeField.checkedText ?? "是"} unCheckedChildren={activeField.uncheckedText ?? "否"} />
              ) : (
                <Input placeholder={activeField.placeholder ?? "输入新值"} />
              )}
            </Form.Item>
          ) : null}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Button onClick={() => setUpdateOpen(false)}>取 消</Button>
            <Button type="primary" htmlType="submit" loading={submitting}>
              确 定
            </Button>
          </div>
        </Form>
      </Modal>

      {/* 批量新增弹窗（JSON 数组） */}
      <Modal
        title="批量新增（JSON 数组）"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        footer={null}
        width={640}
      >
        <div style={{ fontSize: 12, color: "#8c8c8c", marginBottom: 8 }}>
          粘贴 JSON 数组，每个对象一条记录；单条失败不影响其余条目，结果逐条反馈。
        </div>
        <Input.TextArea
          rows={10}
          value={createText}
          onChange={(e) => setCreateText(e.target.value)}
          style={{ fontFamily: "monospace", fontSize: 12 }}
          placeholder={createExample ?? '[\n  { "title": "第一条" },\n  { "title": "第二条" }\n]'}
        />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          <Button onClick={() => setCreateOpen(false)}>取 消</Button>
          <Button type="primary" loading={submitting} onClick={onCreateSubmit}>
            确 定
          </Button>
        </div>
      </Modal>
    </>
  );
}
