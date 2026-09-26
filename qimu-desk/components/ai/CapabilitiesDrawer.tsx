"use client";
import { useRef, useState } from "react";
import { Alert, App, Button, Drawer, Empty, Input, Segmented, Space, Spin, Switch, Tag, Typography } from "antd";
import { DeleteOutlined, PlusOutlined, UploadOutlined } from "@ant-design/icons";
import type { CapabilityKind, CapabilitySummary } from "@/core/ai/capability-schema";

const EXAMPLES: Record<CapabilityKind, string> = {
  skill: `---\nname: writing-assistant\ndescription: 中文写作与润色\n---\n先明确读者和写作目的，再给出结构清晰、语言自然的中文内容。保留原文事实，不编造数据。`,
  mcp: JSON.stringify({ name: "我的 MCP 服务", url: "https://example.com/mcp", headers: { Authorization: "Bearer YOUR_TOKEN" } }, null, 2),
  plugin: JSON.stringify({ name: "写作工具包", description: "写作与校对能力", version: "1.0.0", skills: [{ name: "proofreader", description: "检查用词、错字和逻辑", instructions: "逐项检查原文，给出修订建议和修订后的全文。" }], mcpServers: [] }, null, 2),
};
const LABELS = { skill: "AI Skill", mcp: "MCP", plugin: "插件" };
export default function CapabilitiesDrawer({ open, onClose, capabilities, loading, error, reload }: {
  open: boolean; onClose: () => void; capabilities: CapabilitySummary[]; loading: boolean;
  error: string; reload: () => Promise<void>;
}) {
  const { message, modal } = App.useApp();
  const [kind, setKind] = useState<CapabilityKind>("skill");
  const [source, setSource] = useState(EXAMPLES.skill);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<{ id: number; tools: { name: string; description: string }[]; skills: string[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  async function request(url: string, method: string, body?: unknown) {
    const response = await fetch(url, { method, credentials: "include", headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "操作失败");
    return data;
  }
  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      await request("/api/ai/capabilities", "POST", { kind, source });
      message.success("已添加，可在输入框上方选择使用"); setAdding(false); setSource(EXAMPLES[kind]); await reload();
    } catch (error) { message.error(error instanceof Error ? error.message : "添加失败"); }
    finally { setSaving(false); }
  }
  async function test(id: number) {
    setBusy(id); setTestResult(null);
    try {
      const data = await request(`/api/ai/capabilities/${id}/test`, "POST");
      setTestResult({ id, tools: data.tools, skills: data.skills });
      message.success(`验证通过：${data.skills.length} 个 Skill，${data.tools.length} 个工具`);
    } catch (error) { message.error(error instanceof Error ? error.message : "连接失败"); }
    finally { setBusy(null); }
  }
  return <Drawer title="AI 能力管理" open={open} onClose={onClose} size={620}>
    <Typography.Paragraph type="secondary">添加常用技能和工具。能力仅当前账号可用，启用后可在对话中选择；MCP 认证信息加密保存在服务端。</Typography.Paragraph>
    {error && <Alert type="error" showIcon title={error} action={<Button size="small" onClick={() => void reload()}>重试</Button>} style={{ marginBottom: 16 }} />}
    <Space style={{ marginBottom: 16 }}><Button type="primary" icon={<PlusOutlined />} onClick={() => setAdding(!adding)}>{adding ? "收起添加" : "添加能力"}</Button><Button onClick={() => void reload()} loading={loading}>刷新</Button></Space>
    {adding && <section style={{ border: "1px solid #e5e5e7", borderRadius: 12, padding: 16, marginBottom: 20 }}>
      <Segmented value={kind} disabled={saving} options={Object.entries(LABELS).map(([value, label]) => ({ value, label }))} onChange={(value) => { const next = value as CapabilityKind; setKind(next); setSource(EXAMPLES[next]); }} />
      <Typography.Paragraph type="secondary" style={{ marginTop: 12 }}>
        {kind === "skill" ? "导入带 name、description 头部的 SKILL.md，正文将作为 AI 指令使用。" : kind === "mcp" ? "填写 Streamable HTTP 服务地址及认证请求头，保存后可测试连接并查看工具。" : "插件 JSON 包支持 name、description、version、skills 和 mcpServers，将指令与 MCP 工具组合使用。"}
      </Typography.Paragraph>
      <input ref={fileRef} type="file" accept={kind === "skill" ? ".md,.txt" : ".json"} style={{ display: "none" }} onChange={async (event) => {
        const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
        if (file.size > 300000) { message.error("文件不能超过 300 KB"); return; }
        try { setSource(await file.text()); } catch { message.error("读取文件失败"); }
      }} />
      <Input.TextArea aria-label="能力配置" value={source} onChange={(e) => setSource(e.target.value)} disabled={saving} rows={12} style={{ fontFamily: "monospace" }} />
      <Space style={{ marginTop: 12 }}><Button icon={<UploadOutlined />} disabled={saving} onClick={() => fileRef.current?.click()}>导入文件</Button><Button type="primary" loading={saving} disabled={!source.trim()} onClick={() => void save()}>保存能力</Button></Space>
    </section>}
    {loading ? <Spin /> : !capabilities.length ? <Empty description="尚未添加 AI 能力" /> : <div style={{ display: "grid", gap: 12 }}>
      {capabilities.map((capability) => <section key={capability.id} style={{ border: "1px solid #e5e5e7", borderRadius: 12, padding: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <Typography.Text strong>{capability.name}</Typography.Text>
          <Switch checkedChildren="启用" unCheckedChildren="停用" aria-label={`启用 ${capability.name}`} checked={capability.enabled} disabled={busy !== null} onChange={async (enabled) => {
            setBusy(capability.id);
            try { await request(`/api/ai/capabilities/${capability.id}`, "PATCH", { enabled }); await reload(); }
            catch (error) { message.error(error instanceof Error ? error.message : "更新失败"); }
            finally { setBusy(null); }
          }} />
        </div>
        <Typography.Paragraph type="secondary" style={{ margin: "8px 0" }}>{capability.description}</Typography.Paragraph>
        <Tag>{LABELS[capability.kind]}</Tag><Tag>{capability.skillCount} 个 Skill</Tag><Tag>{capability.serverCount} 个 MCP</Tag>
        <Space style={{ display: "flex", marginTop: 12 }}>
          <Button size="small" disabled={busy !== null && busy !== capability.id} loading={busy === capability.id} onClick={() => void test(capability.id)}>测试与查看工具</Button>
          <Button size="small" danger icon={<DeleteOutlined />} disabled={busy !== null} onClick={() => modal.confirm({ title: `删除「${capability.name}」？`, content: "后续对话将无法再使用该能力。", okText: "删除", cancelText: "取消", onOk: async () => {
            try { await request(`/api/ai/capabilities/${capability.id}`, "DELETE"); await reload(); if (testResult?.id === capability.id) setTestResult(null); }
            catch (error) { message.error(error instanceof Error ? error.message : "删除失败"); throw error; }
          } })}>删除</Button>
        </Space>
        {testResult?.id === capability.id && <div style={{ marginTop: 12 }}>
          {testResult.skills.map((name) => <Tag key={name} color="blue">{name}</Tag>)}
          {testResult.tools.map((tool) => <div key={tool.name} style={{ padding: "6px 0" }}><Typography.Text strong>{tool.name}</Typography.Text><div style={{ color: "#8c8c8c", fontSize: 12 }}>{tool.description}</div></div>)}
          {!testResult.tools.length && !testResult.skills.length && <Typography.Text type="secondary">连接成功，服务未提供工具。</Typography.Text>}
        </div>}
      </section>)}
    </div>}
  </Drawer>;
}
