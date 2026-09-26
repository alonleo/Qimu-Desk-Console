"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Alert, App, Button, Collapse, Empty, Form, Input, Select, Space, Spin, Table, Tabs, Tag } from "antd";
import { ApartmentOutlined, ApiOutlined, CheckCircleFilled, ClockCircleOutlined, CloseCircleFilled, CodeOutlined, FileTextOutlined, PlayCircleFilled, ReloadOutlined, RobotOutlined, SearchOutlined, ThunderboltFilled } from "@ant-design/icons";
import type { StepType, StepLog, WorkflowRecord } from "@/core/workflows";
import RunOutput from "@/components/skills/RunOutput";
import YamlBlock from "@/components/skills/YamlBlock";
import SourceTag from "@/components/SourceTag";
import VisibilityTag from "@/components/VisibilityTag";
import "./workflows.css";

export const STEP_META: Record<StepType, { label: string; color: string; icon: ReactNode }> = {
  shell: { label: "Shell", color: "#389e0d", icon: <CodeOutlined /> },
  http: { label: "HTTP", color: "#08979c", icon: <ApiOutlined /> },
  template: { label: "模板", color: "#345d88", icon: <FileTextOutlined /> },
  skill: { label: "技能", color: "#00856a", icon: <ThunderboltFilled /> },
  llm: { label: "AI", color: "#c87816", icon: <RobotOutlined /> },
};
export type RunSummary = { id: number; workflow_id: number; workflow_name: string; status: string; duration_ms: number | null; triggered_by: string | null; started_at: string; steps?: StepLog[] };
const statusLabels: Record<string, string> = { success: "成功", failed: "失败", running: "运行中", skipped: "已跳过", idle: "未运行" };
function fmtTime(s?: string | null) { return s ? s.replace("T", " ").slice(0, 16) : "—"; }
function fmtDuration(ms?: number | null) { return ms == null ? "—" : ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`; }
function Status({ status }: { status?: string | null }) {
  return <Tag color={status === "success" ? "success" : status === "failed" ? "error" : status === "running" ? "processing" : "default"} icon={status === "success" ? <CheckCircleFilled /> : status === "failed" ? <CloseCircleFilled /> : <ClockCircleOutlined />}>{statusLabels[status || "idle"] || status}</Tag>;
}
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "加载失败，请重试");
  return data;
}

export default function WorkflowsView({ initialWorkflows, initialRuns }: { initialWorkflows: WorkflowRecord[]; initialRuns: RunSummary[] }) {
  const { message, notification } = App.useApp();
  const [workflows, setWorkflows] = useState(initialWorkflows);
  const [runs, setRuns] = useState(initialRuns);
  const [selectedId, setSelectedId] = useState<number | null>(initialWorkflows[0]?.id ?? null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [scope, setScope] = useState("all");
  const [sort, setSort] = useState("name");
  const [tab, setTab] = useState("run");
  const [history, setHistory] = useState<RunSummary[]>([]);
  const [result, setResult] = useState<RunSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [historyError, setHistoryError] = useState("");
  const [submittingId, setSubmittingId] = useState<number | null>(null);
  const [pending, setPending] = useState<Record<number, { workflowId: number; name: string }>>({});
  const [form] = Form.useForm();
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const mounted = useRef(true);
  const submitLock = useRef(false);
  const detailSequence = useRef(0);
  const requestedRun = useRef<RunSummary | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const selected = workflows.find(w => w.id === selectedId);

  const refresh = useCallback(async () => {
    const [list, recent] = await Promise.all([
      request<{ workflows: WorkflowRecord[] }>("/api/workflows"),
      request<{ runs: RunSummary[] }>("/api/workflow-runs?limit=100"),
    ]);
    if (!mounted.current) return;
    setWorkflows(list.workflows);
    setRuns(recent.runs);
    setSelectedId(id => list.workflows.some(w => w.id === id) ? id : list.workflows[0]?.id ?? null);
    setError("");
  }, []);

  const loadHistory = useCallback(async (id: number) => {
    const sequence = ++detailSequence.current;
    setLoading(true);
    setHistoryError("");
    try {
      const data = await request<{ runs: RunSummary[] }>(`/api/workflows/${id}`);
      if (mounted.current && selectedRef.current === id && sequence === detailSequence.current) setHistory(data.runs);
    } catch (e) {
      if (mounted.current && selectedRef.current === id && sequence === detailSequence.current) setHistoryError((e as Error).message);
    } finally {
      if (mounted.current && selectedRef.current === id && sequence === detailSequence.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let busy = false;
    const tick = async () => {
      if (busy || document.visibilityState !== "visible") return;
      busy = true;
      try { await refresh(); } catch { if (mounted.current) setError("自动同步失败，当前展示上次数据。请检查连接后刷新。"); } finally { busy = false; }
    };
    const timer = setInterval(tick, 10_000);
    window.addEventListener("focus", tick);
    return () => { clearInterval(timer); window.removeEventListener("focus", tick); };
  }, [refresh]);

  useEffect(() => {
    setHistory([]);
    const requested = requestedRun.current;
    setResult(requested?.workflow_id === selectedId ? requested : null);
    setTab(requested?.workflow_id === selectedId ? "logs" : "run");
    requestedRun.current = null;
    form.resetFields();
    if (selectedId != null) void loadHistory(selectedId);
  }, [selectedId, form, loadHistory]);

  useEffect(() => {
    const activeRuns = runs.filter(r => r.status === "running");
    setPending(prev => {
      const missing = activeRuns.filter(r => !prev[r.id]);
      return missing.length ? { ...prev, ...Object.fromEntries(missing.map(r => [r.id, { workflowId: r.workflow_id, name: r.workflow_name }])) } : prev;
    });
  }, [runs]);

  // 每次提交独立跟踪；切换工作流不影响通知，也不会把结果写入其他工作流。
  useEffect(() => {
    if (!Object.keys(pending).length) return;
    let disposed = false;
    let busy = false;
    const tick = async () => {
      if (busy) return;
      busy = true;
      await Promise.all(Object.entries(pending).map(async ([id, entry]) => {
        try {
          const data = await request<{ runs: RunSummary[] }>(`/api/workflow-runs?runId=${id}`);
          if (disposed || !mounted.current) return;
          const hit = data.runs.find(r => r.id === Number(id));
          if (!hit) return;
          setRuns(prev => [hit, ...prev.filter(r => r.id !== hit.id)].sort((a, b) => b.id - a.id).slice(0, 100));
          if (selectedRef.current === entry.workflowId) setResult(prev => !prev || prev.id === hit.id ? hit : prev);
          if (hit.status === "running") return;
          setPending(prev => { const next = { ...prev }; delete next[hit.id]; return next; });
          if (selectedRef.current === entry.workflowId) void loadHistory(entry.workflowId);
          notification[hit.status === "success" ? "success" : "error"]({ key: `workflow-${id}`, title: `${entry.name} · ${statusLabels[hit.status] || hit.status}`, description: `运行 #${id} · 耗时 ${fmtDuration(hit.duration_ms)}`, placement: "topRight" });
          void refresh().catch(() => {});
        } catch { /* 下一轮继续跟踪，页面同步状态单独提示连接异常。 */ }
      }));
      busy = false;
    };
    void tick();
    const timer = setInterval(tick, 2000);
    return () => { disposed = true; clearInterval(timer); };
  }, [pending, loadHistory, notification, refresh]);

  const filtered = useMemo(() => workflows.filter(w => {
    const text = `${w.displayName} ${w.name} ${w.description}`.toLowerCase();
    return text.includes(search.trim().toLowerCase()) && (status === "all" || (w.lastRunStatus || "idle") === status) && (scope === "all" || (w.visibility || "public") === scope);
  }).sort((a, b) => sort === "recent" ? (b.lastRunAt || "").localeCompare(a.lastRunAt || "") : sort === "popular" ? b.runCount - a.runCount : a.displayName.localeCompare(b.displayName, "zh-CN")), [workflows, search, status, scope, sort]);
  const active = selected && (submittingId === selected.id || Object.values(pending).some(p => p.workflowId === selected.id) || runs.some(r => r.workflow_id === selected.id && r.status === "running"));

  async function manualRefresh() {
    setRefreshing(true);
    try { await refresh(); if (selectedRef.current != null) await loadHistory(selectedRef.current); } catch (e) { setError((e as Error).message); } finally { setRefreshing(false); }
  }
  async function run(values: Record<string, string>) {
    if (!selected || submitLock.current || active) return;
    submitLock.current = true;
    const workflow = selected;
    setSubmittingId(workflow.id);
    try {
      const data = await request<{ runId: number }>(`/api/workflows/${workflow.id}/run`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ params: values, async: true }) });
      if (!mounted.current) return;
      setPending(prev => ({ ...prev, [data.runId]: { workflowId: workflow.id, name: workflow.displayName } }));
      const record: RunSummary = { id: data.runId, workflow_id: workflow.id, workflow_name: workflow.name, status: "running", duration_ms: null, triggered_by: "我", started_at: new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }), steps: [] };
      setRuns(prev => [record, ...prev]);
      if (selectedRef.current === workflow.id) { setResult(record); setTab("logs"); }
      message.success("已开始运行，可切换工作流，完成后会通知你");
    } catch (e) { message.error((e as Error).message); } finally { submitLock.current = false; if (mounted.current) setSubmittingId(null); }
  }
  function showRun(record: RunSummary) {
    setResult(record);
    setTab("logs");
    if (record.status === "running") setPending(prev => ({ ...prev, [record.id]: { workflowId: record.workflow_id, name: selected?.displayName || record.workflow_name } }));
  }

  return <div className="wf-workspace">
    <header className="wf-heading"><div><span className="wf-eyebrow">自动化 / 工作流</span><h1>工作流</h1><p>串联技能与工具，让重复的工作按步骤完成。</p></div><Button icon={<ReloadOutlined />} loading={refreshing} onClick={manualRefresh}>刷新</Button></header>
    <div className="wf-summary" aria-label="工作流概况">
      <div><span>可用工作流</span><strong>{workflows.length}</strong></div>
      <div><span>流程步骤</span><strong>{workflows.reduce((sum, w) => sum + w.stepCount, 0)}</strong></div>
      <div><span>最近运行中</span><strong>{runs.filter(r => r.status === "running").length}</strong></div>
      <div><span>最近失败</span><strong className={runs.some(r => r.status === "failed") ? "wf-danger" : ""}>{runs.filter(r => r.status === "failed").length}</strong></div>
    </div>
    {error && <Alert type="warning" showIcon title={error} action={<Button size="small" onClick={manualRefresh} loading={refreshing}>重试</Button>} />}
    <div className="wf-layout">
      <aside className="wf-catalog" aria-label="工作流目录">
        <div className="wf-catalog-tools"><div className="wf-section-heading"><h2>工作流目录</h2><span>{filtered.length} / {workflows.length}</span></div>
          <Input prefix={<SearchOutlined />} placeholder="搜索名称、描述" aria-label="搜索工作流" value={search} allowClear onChange={e => setSearch(e.target.value)} />
          <div className="wf-filters"><Select aria-label="运行状态筛选" value={status} onChange={setStatus} options={[{ value: "all", label: "全部状态" }, ...["idle", "running", "success", "failed"].map(value => ({ value, label: statusLabels[value] }))]} /><Select aria-label="可见范围筛选" value={scope} onChange={setScope} options={[{ value: "all", label: "全部范围" }, { value: "public", label: "通用工作流" }, { value: "personal", label: "个人工作流" }]} /></div>
          <Select className="wf-sort" aria-label="工作流排序" value={sort} onChange={setSort} options={[{ value: "name", label: "按名称排序" }, { value: "recent", label: "最近运行优先" }, { value: "popular", label: "运行次数优先" }]} />
        </div>
        <div className="wf-catalog-list">{filtered.map(w => <button type="button" key={w.id} className={`wf-catalog-item ${w.id === selectedId ? "is-selected" : ""}`} aria-pressed={w.id === selectedId} onClick={() => setSelectedId(w.id)}><div className="wf-item-title"><ApartmentOutlined /><strong>{w.displayName}</strong><Status status={w.lastRunStatus} /></div><p>{w.description || "暂无描述"}</p><div className="wf-item-meta"><span>{w.stepCount} 步 · {w.params.length} 个参数</span><span>已运行 {w.runCount} 次</span></div></button>)}
          {!filtered.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={workflows.length ? "没有符合条件的工作流" : "暂无工作流，请在管理后台添加"}>{workflows.length > 0 && <Button onClick={() => { setSearch(""); setStatus("all"); setScope("all"); }}>清除筛选</Button>}</Empty>}
        </div>
      </aside>
      <section className="wf-detail" aria-label="工作流工作区">
        {!selected ? <Empty description="选择工作流，查看步骤并开始运行" /> : <>
          <div className="wf-detail-heading"><div className="wf-section-heading"><div><span className="wf-eyebrow">{selected.name} · v{selected.version}</span><h2>{selected.displayName}</h2></div><Space wrap><VisibilityTag value={selected.visibility} /><SourceTag source={selected.source} /></Space></div><p>{selected.description || "暂无描述"}</p><span className="wf-caption">上次运行 {fmtTime(selected.lastRunAt)} · 累计 {selected.runCount} 次</span></div>
          <Tabs activeKey={tab} onChange={setTab} items={[
            { key: "run", label: "流程与运行", children: <div className="wf-execution"><section><div className="wf-section-heading"><h3>执行步骤</h3><span>按顺序执行 · {selected.stepCount} 步</span></div><ol className="wf-steps">{selected.steps.map((step, index) => <li key={step.id}><span className="wf-step-number">{index + 1}</span><div><strong>{step.name}</strong><code>{step.id}</code></div><Tag icon={STEP_META[step.type]?.icon} color={STEP_META[step.type]?.color}>{STEP_META[step.type]?.label || step.type}</Tag></li>)}</ol>{!selected.steps.length && <Empty description="尚未配置步骤" image={Empty.PRESENTED_IMAGE_SIMPLE} />}</section><section className="wf-parameters"><h3>运行参数</h3><p>确认输入后开始执行。</p><Form key={selected.id} form={form} layout="vertical" initialValues={Object.fromEntries(selected.params.map(p => [p.name, p.default ?? ""]))} onFinish={run} disabled={!!active}>
              {!selected.params.length && <div className="wf-no-params"><ThunderboltFilled /><span>无需填写参数，可以直接运行。</span></div>}
              {selected.params.map(p => <Form.Item key={p.name} name={p.name} label={p.label || p.name} extra={p.description} rules={[{ required: p.required, whitespace: true, message: `请输入${p.label || p.name}` }]}>{p.multiline ? <Input.TextArea rows={3} placeholder={`输入${p.label || p.name}`} /> : <Input allowClear placeholder={`输入${p.label || p.name}`} />}</Form.Item>)}
              <Button type="primary" htmlType="submit" block size="large" icon={<PlayCircleFilled />} loading={submittingId === selected.id} disabled={!!active || !selected.stepCount}>{active ? "运行中" : "运行工作流"}</Button>
              <Button className="wf-reset" type="text" block onClick={() => form.resetFields()} disabled={!!active}>恢复默认参数</Button>
            </Form><span className="wf-caption">步骤失败时停止执行，后续步骤会标记为跳过。</span></section></div> },
            { key: "logs", label: "运行日志", children: <div className="wf-tab-body">{!result ? <Empty description="运行工作流或从运行历史中选择一条记录" image={Empty.PRESENTED_IMAGE_SIMPLE} /> : <><div className="wf-section-heading"><Space wrap><h3>运行 #{result.id}</h3><Status status={result.status} /></Space><span>{fmtDuration(result.duration_ms)}</span></div>{result.status === "running" && <Alert showIcon type="info" title="正在后台执行，结果会自动更新" description="可继续浏览其他工作流，完成后将收到通知。" />}<StepResults steps={result.steps || []} />{result.status !== "running" && !result.steps?.length && <Empty description="本次运行没有步骤日志" image={Empty.PRESENTED_IMAGE_SIMPLE} />}</>}</div> },
            { key: "history", label: "运行历史", children: <div className="wf-tab-body">{historyError && <Alert type="error" title={historyError} action={<Button onClick={() => loadHistory(selected.id)}>重试</Button>} />}<Spin spinning={loading}><RunTable runs={history} onOpen={showRun} /></Spin><p className="wf-caption">展示该工作流最近 10 次运行，点击记录查看逐步输出。</p></div> },
            { key: "definition", label: "流程定义", children: <div className="wf-tab-body">{selected.sourceText ? <YamlBlock source={selected.sourceText} maxHeight={600} /> : <Empty description="此工作流未保存 YAML 原文" image={Empty.PRESENTED_IMAGE_SIMPLE} />}</div> },
          ]} />
        </>}
      </section>
    </div>
    <section className="wf-recent"><div className="wf-section-heading"><h2>最近运行</h2><span>最近 {runs.length} 条记录 · 每 10 秒同步</span></div><RunTable runs={runs} onOpen={record => { if (record.workflow_id === selectedId) showRun(record); else { requestedRun.current = record; setSelectedId(record.workflow_id); } }} /></section>
  </div>;
}

function RunTable({ runs, onOpen }: { runs: RunSummary[]; onOpen: (run: RunSummary) => void }) {
  return <Table<RunSummary> rowKey="id" size="small" dataSource={runs} scroll={{ x: 620 }} pagination={runs.length > 8 ? { defaultPageSize: 8, showSizeChanger: false } : false} locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无运行记录" /> }} columns={[
    { title: "运行", key: "name", render: (_, r) => <Button type="link" onClick={() => onOpen(r)}>#{r.id} · {r.workflow_name}</Button> },
    { title: "状态", key: "status", render: (_, r) => <Status status={r.status} /> },
    { title: "耗时", key: "duration", render: (_, r) => fmtDuration(r.duration_ms) },
    { title: "触发人", dataIndex: "triggered_by", render: v => v || "—" },
    { title: "开始时间", dataIndex: "started_at", render: fmtTime },
  ]} />;
}
function StepResults({ steps }: { steps: StepLog[] }) {
  return <Collapse className="wf-step-results" items={steps.map(s => ({ key: s.stepId, label: <Space wrap><Status status={s.status} /><strong>{s.name}</strong><span>{fmtDuration(s.durationMs)}</span></Space>, children: <>{s.error && <Alert type="error" showIcon title={s.error} />}{s.output ? <RunOutput output={s.output} maxHeight={360} /> : <p className="wf-caption">{s.status === "skipped" ? "前序步骤失败，本步骤未执行。" : "无输出"}</p>}</> }))} />;
}
