"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  App,
  Avatar,
  Button,
  Card,
  Col,
  Collapse,
  Drawer,
  Empty,
  Form,
  Input,
  Row,
  Space,
  Tag,
  Typography,
} from "antd";
import {
  ApartmentOutlined,
  ApiOutlined,
  CheckCircleFilled,
  ClockCircleOutlined,
  CloseCircleFilled,
  CodeOutlined,
  FileTextOutlined,
  HistoryOutlined,
  LoadingOutlined,
  MinusCircleFilled,
  PlayCircleFilled,
  RobotOutlined,
  ThunderboltFilled,
} from "@ant-design/icons";
import type {
  StepType,
  StepLog,
  WorkflowRecord,
} from "@/core/workflows";
import type { SkillParam } from "@/core/skills";
import RunOutput from "@/components/skills/RunOutput";
import YamlBlock from "@/components/skills/YamlBlock";
import SourceTag from "@/components/SourceTag";
import VisibilityTag from "@/components/VisibilityTag";

/** 五类步骤的视觉标识（图标 + 专属色） */
export const STEP_META: Record<StepType, { label: string; color: string; icon: ReactNode }> = {
  shell: { label: "Shell", color: "#52c41a", icon: <CodeOutlined /> },
  http: { label: "HTTP", color: "#13c2c2", icon: <ApiOutlined /> },
  template: { label: "模板", color: "#1677ff", icon: <FileTextOutlined /> },
  skill: { label: "技能", color: "#00c896", icon: <ThunderboltFilled /> },
  llm: { label: "AI", color: "#fa8c16", icon: <RobotOutlined /> },
};

const MODULE_COLOR = "#fa8c16";

/** 页面级最近运行（轻量，不含日志） */
export type RunSummary = {
  id: number;
  workflow_name: string;
  status: string;
  duration_ms: number | null;
  triggered_by: string | null;
  started_at: string;
};

type RunView = {
  runId: number;
  status: string;
  durationMs: number | null;
  steps: StepLog[];
};

function gradient(color: string): string {
  return color;
}

/** 时间展示：MySQL 以本地时（Asia/Shanghai）存文本，直接按文本截取，不做时区换算 */
function fmtTime(s?: string | null): string {
  if (!s) return "-";
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(s);
  if (!m) return s;
  return `${m[2]}-${m[3]} ${m[4]}:${m[5]}`;
}

function fmtDuration(ms?: number | null): string {
  if (ms === null || ms === undefined) return "-";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function RunStatusIcon({ status }: { status: string }) {
  if (status === "success") return <CheckCircleFilled style={{ color: "#52c41a", fontSize: 15 }} />;
  if (status === "failed") return <CloseCircleFilled style={{ color: "#ff4d4f", fontSize: 15 }} />;
  return <ClockCircleOutlined style={{ color: "#faad14", fontSize: 15 }} />;
}

export default function WorkflowsView({
  initialWorkflows,
  initialRuns,
}: {
  initialWorkflows: WorkflowRecord[];
  initialRuns: RunSummary[];
}) {
  const { message, notification } = App.useApp();
  const [workflows, setWorkflows] = useState<WorkflowRecord[]>(initialWorkflows);
  const [selected, setSelected] = useState<WorkflowRecord | null>(null);
  const [drawerRuns, setDrawerRuns] = useState<(RunSummary & { steps: StepLog[] })[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunView | null>(null);
  const [runLog, setRunLog] = useState<RunSummary[]>(initialRuns);
  const [form] = Form.useForm();
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  // 组件卸载时清理结果轮询
  useEffect(() => stopPolling, [stopPolling]);

  const totalSteps = useMemo(
    () => workflows.reduce((n, w) => n + w.stepCount, 0),
    [workflows]
  );

  /** 静默刷新：管理后台增删工作流后，工作台无需手动刷新即可同步。
   *  仅在数据真正变化时 setState，避免每 10s 轮询把全部卡片无差别重渲染（表现为"整页都在刷新"） */
  const refresh = useCallback(async () => {
    try {
      const [list, runs] = await Promise.all([
        fetch("/api/workflows").then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch("/api/workflow-runs?limit=10").then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ]);
      if (list?.workflows) {
        const next: WorkflowRecord[] = list.workflows;
        setWorkflows((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
        // 选中的工作流已被删除 → 自动收起抽屉；数据无变化时保留原引用（不触发抽屉重渲染）
        setSelected((prev) => {
          if (!prev) return null;
          const hit = next.find((w) => w.id === prev.id);
          if (!hit) return null;
          return JSON.stringify(hit) === JSON.stringify(prev) ? prev : hit;
        });
      }
      if (runs?.runs) {
        setRunLog((prev) => (JSON.stringify(prev) === JSON.stringify(runs.runs) ? prev : runs.runs));
      }
    } catch {
      /* 静默刷新失败不打扰用户 */
    }
  }, []);

  useEffect(() => {
    // 页面可见期间每 10s 轮询；切回标签页 / 窗口聚焦时立即刷新
    const tick = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const id = setInterval(tick, 10_000);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("focus", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener("focus", tick);
    };
  }, [refresh]);

  async function openWorkflow(w: WorkflowRecord) {
    setSelected(w);
    setResult(null);
    stopPolling(); // 切换工作流时终止上一轮结果轮询
    const defaults: Record<string, string> = {};
    for (const p of w.params) if (p.default !== undefined) defaults[p.name] = p.default;
    form.resetFields();
    form.setFieldsValue(defaults);
    setDrawerRuns([]);
    setRunsLoading(true);
    try {
      const res = await fetch(`/api/workflows/${w.id}`);
      if (res.ok) {
        const data = await res.json();
        setDrawerRuns(
          (data.runs || []).map((r: RunSummary & { steps: StepLog[] }) => ({
            id: r.id,
            workflow_name: r.workflow_name,
            status: r.status,
            duration_ms: r.duration_ms,
            triggered_by: r.triggered_by,
            started_at: r.started_at,
            steps: r.steps || [],
          }))
        );
      }
    } catch {
      /* 历史加载失败不阻塞抽屉 */
    } finally {
      setRunsLoading(false);
    }
  }

  /** 本地时间文本（与 MySQL 存储格式对齐） */
  function localNow(): string {
    const n = new Date();
    const p = (x: number) => String(x).padStart(2, "0");
    return `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())} ${p(n.getHours())}:${p(
      n.getMinutes()
    )}:${p(n.getSeconds())}`;
  }

  /** 刷新抽屉内运行历史（静默） */
  async function reloadDrawerRuns(workflowId: number) {
    const detail = await fetch(`/api/workflows/${workflowId}`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    if (detail?.runs) {
      setDrawerRuns(
        detail.runs.map((r: RunSummary & { steps: StepLog[] }) => ({
          id: r.id,
          workflow_name: r.workflow_name,
          status: r.status,
          duration_ms: r.duration_ms,
          triggered_by: r.triggered_by,
          started_at: r.started_at,
          steps: r.steps || [],
        }))
      );
    }
  }

  /**
   * 后台执行：提交后接口立即返回 runId（不卡界面），
   * 每 2s 轮询运行状态，完成后顶部 notification 弹窗通知并展示结果。
   */
  async function doRun() {
    if (!selected) return;
    const values = (await form.validateFields()) as Record<string, string>;
    stopPolling();
    setRunning(true);
    setResult(null);
    try {
      const res = await fetch(`/api/workflows/${selected.id}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ params: values, async: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "提交失败");
      const runId = data.runId as number;
      const wf = selected; // 捕获当前工作流，轮询回调期间抽屉可能已切换

      // 乐观插入一条 running 记录（10s 静默刷新也会自动纠正）
      setRunLog((prev) =>
        [
          {
            id: runId,
            workflow_name: wf.displayName || wf.name,
            status: "running",
            duration_ms: null,
            triggered_by: "我",
            started_at: localNow(),
          } as RunSummary,
          ...prev,
        ].slice(0, 10)
      );

      // 提交成功即解锁界面，转入后台等待
      setRunning(false);
      message.success(`已提交后台执行（运行 #${runId}），完成后顶部通知`);

      pollTimerRef.current = setInterval(async () => {
        try {
          const rr = await fetch(`/api/workflow-runs?workflowId=${wf.id}&limit=10`);
          if (!rr.ok) return;
          const dd = await rr.json();
          const hit = ((dd.runs || []) as (RunSummary & { steps: StepLog[] })[]).find(
            (x) => x.id === runId
          );
          // 仍在执行 / 记录尚未可见 → 继续等待
          if (!hit || hit.status === "running") return;
          stopPolling();

          const steps = hit.steps || [];
          setResult({
            runId,
            status: hit.status,
            durationMs: hit.duration_ms,
            steps,
          });
          setRunLog((prev) =>
            prev.map((r) =>
              r.id === runId
                ? { ...r, status: hit.status, duration_ms: hit.duration_ms, started_at: hit.started_at }
                : r
            )
          );
          setWorkflows((prev) =>
            prev.map((w) =>
              w.id === wf.id ? { ...w, lastRunAt: hit.started_at, lastRunStatus: hit.status } : w
            )
          );
          void reloadDrawerRuns(wf.id);
          refresh();

          const failedStep = steps.find((s) => s.status === "failed");
          if (hit.status === "success") {
            notification.success({
              key: `wf-run-${runId}`,
              message: `工作流「${wf.displayName || wf.name}」执行成功`,
              description: `总耗时 ${fmtDuration(hit.duration_ms)} · ${steps.length} 个步骤`,
              placement: "top",
              duration: 4.5,
            });
          } else {
            notification.error({
              key: `wf-run-${runId}`,
              message: `工作流「${wf.displayName || wf.name}」执行失败`,
              description: failedStep?.error || "存在失败步骤，详情见抽屉运行结果",
              placement: "top",
              duration: 8,
            });
          }
        } catch {
          /* 单次轮询失败静默重试 */
        }
      }, 2000);
    } catch (e) {
      setRunning(false);
      message.error((e as Error).message);
    }
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* 页头 */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <Space>
          <Avatar shape="square" size={36} style={{ background: "#eaf0f6", color: "#345d88", fontSize: 18 }}>
            <ApartmentOutlined />
          </Avatar>
          <div>
            <Typography.Title level={4} style={{ margin: 0 }}>
              工作流
            </Typography.Title>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {workflows.length} 个工作流 · {totalSteps} 个步骤
            </Typography.Text>
          </div>
        </Space>
      </div>

      {/* 工作流卡片 */}
      {workflows.length === 0 ? (
        <Card style={{ borderRadius: 8 }}>
          <Empty
            description="暂无工作流，请在管理后台添加。"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        </Card>
      ) : (
        <Row gutter={[16, 16]} align="stretch">
          {workflows.map((w) => (
            <Col xs={24} sm={12} lg={8} key={w.id} style={{ display: "flex" }}>
              <Card
                hoverable
                style={{ height: "100%", borderRadius: 8, borderColor: "#e2e7ec" }}
                onClick={() => openWorkflow(w)}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <Avatar size={44} style={{ background: gradient(w.color), fontSize: 20 }}>
                    <ApartmentOutlined />
                  </Avatar>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontWeight: 600,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {w.displayName}
                    </div>
                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                      {w.name} · v{w.version}
                    </Typography.Text>
                  </div>
                  <Space
                    size={4}
                    style={{ flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end", maxWidth: "55%" }}
                  >
                    <Tag color={w.color} style={{ margin: 0 }}>
                      {w.stepCount} 步
                    </Tag>
                    <VisibilityTag value={w.visibility} style={{ margin: 0 }} />
                    <SourceTag source={w.source} />
                  </Space>
                </div>
                <p
                  style={{
                    margin: "12px 0 0",
                    fontSize: 12,
                    color: "#595959",
                    height: 36,
                    overflow: "hidden",
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                  }}
                >
                  {w.description || "暂无描述"}
                </p>
                <div
                  style={{
                    display: "flex",
                    gap: 4,
                    flexWrap: "wrap",
                    marginTop: 10,
                  }}
                >
                  {w.steps.slice(0, 5).map((s) => (
                    <Tag
                      key={s.id}
                      style={{
                        margin: 0,
                        fontSize: 10,
                        borderRadius: 4,
                        padding: "0 6px",
                        lineHeight: "18px",
                      }}
                      color={STEP_META[s.type]?.color}
                    >
                      {STEP_META[s.type]?.label || s.type}
                    </Tag>
                  ))}
                  {w.steps.length > 5 && (
                    <Tag style={{ margin: 0, fontSize: 10 }}>+{w.steps.length - 5}</Tag>
                  )}
                </div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginTop: 12,
                  }}
                >
                  <Space size={8} style={{ fontSize: 11, color: "#8c8c8c" }}>
                    {w.params.length > 0 && <span>{w.params.length} 个参数</span>}
                    <span>已执行 {w.runCount} 次</span>
                  </Space>
                  {w.lastRunStatus ? (
                    w.lastRunStatus === "success" ? (
                      <Tag icon={<CheckCircleFilled />} color="success" style={{ margin: 0 }}>
                        最近成功
                      </Tag>
                    ) : (
                      <Tag icon={<CloseCircleFilled />} color="error" style={{ margin: 0 }}>
                        最近失败
                      </Tag>
                    )
                  ) : (
                    <Tag icon={<ClockCircleOutlined />} style={{ margin: 0 }}>
                      未执行
                    </Tag>
                  )}
                </div>
              </Card>
            </Col>
          ))}
        </Row>
      )}

      {/* 最近运行 */}
      <Card
        style={{ borderRadius: 8 }}
        title={
          <Space>
            <HistoryOutlined style={{ color: MODULE_COLOR }} />
            <span>最近运行</span>
          </Space>
        }
      >
        {runLog.length === 0 ? (
          <Empty description="还没有运行记录，点开一个工作流试试" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <div style={{ display: "grid" }}>
            {runLog.map((r) => (
              <div
                key={r.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 6px",
                  borderBottom: "1px solid #f0f0f0",
                }}
              >
                <RunStatusIcon status={r.status} />
                <Typography.Text strong style={{ fontSize: 13 }}>
                  {r.workflow_name}
                </Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {fmtDuration(r.duration_ms)}
                </Typography.Text>
                <span style={{ flex: 1 }} />
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {r.triggered_by || "-"}
                </Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12, minWidth: 86, textAlign: "right" }}>
                  {fmtTime(r.started_at)}
                </Typography.Text>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* 详情抽屉 */}
      <Drawer
        open={!!selected}
        onClose={() => setSelected(null)}
        width={680}
        title={
          selected ? (
            <Space>
              <Avatar size={30} style={{ background: gradient(selected.color), fontSize: 14 }}>
                <ApartmentOutlined />
              </Avatar>
              <span>{selected.displayName}</span>
              <Typography.Text type="secondary" copyable style={{ fontSize: 12 }}>
                {selected.name}
              </Typography.Text>
            </Space>
          ) : null
        }
      >
        {selected && (
          <div style={{ display: "grid", gap: 4 }}>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 12, fontSize: 13 }}>
              {selected.description || "暂无描述"}
            </Typography.Paragraph>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
              <Tag color={selected.color}>{selected.stepCount} 个步骤</Tag>
              <VisibilityTag value={selected.visibility} />
              <SourceTag source={selected.source} />
              {selected.params.length > 0 && <Tag>{selected.params.length} 个参数</Tag>}
              <Tag>版本 v{selected.version}</Tag>
              <Tag>已执行 {selected.runCount} 次</Tag>
              {selected.lastRunAt && <Tag icon={<ClockCircleOutlined />}>上次 {fmtTime(selected.lastRunAt)}</Tag>}
            </div>

            {/* 流程概览 */}
            <Typography.Title level={5} style={{ marginTop: 0 }}>
              流程
            </Typography.Title>
            <div style={{ display: "grid", gap: 6, marginBottom: 20 }}>
              {selected.steps.map((s, i) => {
                const meta = STEP_META[s.type];
                return (
                  <div
                    key={s.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "8px 12px",
                      borderRadius: 8,
                      background: "#fafafa",
                    }}
                  >
                    <span
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: "50%",
                        background: meta?.color || "#8c8c8c",
                        color: "#fff",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 11,
                        fontWeight: 600,
                        flexShrink: 0,
                      }}
                    >
                      {i + 1}
                    </span>
                    <Typography.Text strong style={{ fontSize: 13 }}>
                      {s.name}
                    </Typography.Text>
                    <Tag
                      color={meta?.color}
                      style={{ margin: 0, fontSize: 10, borderRadius: 4, padding: "0 6px", lineHeight: "18px" }}
                    >
                      {meta?.label || s.type}
                    </Tag>
                    <span style={{ flex: 1 }} />
                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                      {s.id}
                    </Typography.Text>
                  </div>
                );
              })}
            </div>

            {/* 执行区 */}
            <Typography.Title level={5} style={{ marginTop: 0 }}>
              运行
            </Typography.Title>
            {selected.params.length === 0 ? (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                该工作流无需参数，直接运行即可。
              </Typography.Text>
            ) : (
              <Form form={form} layout="vertical">
                {selected.params.map((p: SkillParam) => (
                  <Form.Item
                    key={p.name}
                    name={p.name}
                    label={
                      <Space size={6}>
                        <span>{p.label || p.name}</span>
                        {p.required && (
                          <Tag color="red" style={{ margin: 0, fontSize: 10 }}>
                            必填
                          </Tag>
                        )}
                      </Space>
                    }
                    extra={p.description}
                    style={{ marginBottom: 12 }}
                  >
                    {p.multiline ? (
                      <Input.TextArea rows={3} placeholder={`输入 ${p.label || p.name}`} />
                    ) : (
                      <Input placeholder={p.default || `输入 ${p.label || p.name}`} allowClear />
                    )}
                  </Form.Item>
                ))}
              </Form>
            )}
            <Button
              type="primary"
              icon={<PlayCircleFilled />}
              loading={running}
              onClick={doRun}
              size="large"
              block
            >
              运行工作流
            </Button>

            {/* 运行结果：逐步时间线 */}
            {result && (
              <Card size="small" style={{ marginTop: 16, borderRadius: 10, background: "#fafafa" }}>
                <Space style={{ marginBottom: 8 }}>
                  <Tag color={result.status === "success" ? "success" : "error"}>
                    {result.status === "success" ? "成功" : "失败"}
                  </Tag>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    总耗时 {fmtDuration(result.durationMs)} · {result.steps.length} 个步骤
                  </Typography.Text>
                </Space>
                <Collapse
                  size="small"
                  defaultActiveKey={result.steps.map((s) => s.stepId)}
                  items={result.steps.map((s) => {
                    const meta = STEP_META[s.type];
                    return {
                      key: s.stepId,
                      label: (
                        <Space size={8}>
                          {s.status === "success" ? (
                            <CheckCircleFilled style={{ color: "#52c41a", fontSize: 14 }} />
                          ) : s.status === "failed" ? (
                            <CloseCircleFilled style={{ color: "#ff4d4f", fontSize: 14 }} />
                          ) : (
                            <MinusCircleFilled style={{ color: "#bfbfbf", fontSize: 14 }} />
                          )}
                          <Typography.Text strong style={{ fontSize: 12 }}>
                            {s.name}
                          </Typography.Text>
                          <Tag
                            color={meta?.color}
                            style={{ margin: 0, fontSize: 10, borderRadius: 4, padding: "0 5px", lineHeight: "16px" }}
                          >
                            {meta?.label || s.type}
                          </Tag>
                          {s.durationMs > 0 && (
                            <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                              {fmtDuration(s.durationMs)}
                            </Typography.Text>
                          )}
                          {s.status === "skipped" && (
                            <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                              已跳过
                            </Typography.Text>
                          )}
                        </Space>
                      ),
                      children: (
                        <div>
                          {s.error ? (
                            <div
                              style={{
                                color: "#ff4d4f",
                                marginBottom: s.output ? 8 : 0,
                                fontSize: 12,
                              }}
                            >
                              ✗ {s.error}
                            </div>
                          ) : null}
                          {s.output ? (
                            <RunOutput output={s.output} maxHeight={320} />
                          ) : (
                            !s.error && (
                              <Typography.Text type="secondary">（无输出）</Typography.Text>
                            )
                          )}
                        </div>
                      ),
                    };
                  })}
                />
              </Card>
            )}

            {/* 运行历史 */}
            <Typography.Title level={5} style={{ marginTop: 24 }}>
              运行历史
            </Typography.Title>
            {runsLoading ? (
              <div style={{ textAlign: "center", padding: 24, color: "#8c8c8c" }}>
                <LoadingOutlined style={{ fontSize: 18, marginRight: 8 }} />
                加载中…
              </div>
            ) : drawerRuns.length === 0 ? (
              <Empty description="暂无运行记录" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              <div style={{ display: "grid" }}>
                {drawerRuns.map((r) => (
                  <div
                    key={r.id}
                    onClick={() =>
                      setResult({
                        runId: r.id,
                        status: r.status,
                        durationMs: r.duration_ms,
                        steps: r.steps || [],
                      })
                    }
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "8px 6px",
                      borderBottom: "1px solid #f0f0f0",
                      cursor: "pointer",
                      borderRadius: 6,
                    }}
                  >
                    <RunStatusIcon status={r.status} />
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {fmtTime(r.started_at)}
                    </Typography.Text>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {fmtDuration(r.duration_ms)}
                    </Typography.Text>
                    <span style={{ flex: 1 }} />
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {r.triggered_by || "-"}
                    </Typography.Text>
                  </div>
                ))}
              </div>
            )}

            {/* 定义查看 */}
            <Collapse
              ghost
              style={{ marginTop: 16 }}
              items={[
                {
                  key: "src",
                  label: (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      查看 YAML 定义
                    </Typography.Text>
                  ),
                  children: <YamlBlock source={selected.sourceText || ""} maxHeight={320} />,
                },
              ]}
            />
          </div>
        )}
      </Drawer>
    </div>
  );
}
