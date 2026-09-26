"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
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
  ApiOutlined,
  CheckCircleFilled,
  ClockCircleOutlined,
  CloseCircleFilled,
  CodeOutlined,
  FileTextOutlined,
  HistoryOutlined,
  LoadingOutlined,
  PlayCircleFilled,
  ThunderboltFilled,
} from "@ant-design/icons";
import type { SkillConfig, SkillParam, SkillType, RunItem, SkillRecord, RunResult } from "@/core/skills";
import SourceTag from "@/components/SourceTag";
import VisibilityTag from "@/components/VisibilityTag";
import RunOutput from "@/components/skills/RunOutput";
import YamlBlock from "@/components/skills/YamlBlock";

/** 三类技能的视觉标识（图标 + 专属色） */
export const TYPE_META: Record<SkillType, { label: string; color: string; icon: ReactNode }> = {
  shell: { label: "Shell", color: "#52c41a", icon: <CodeOutlined /> },
  prompt: { label: "Prompt", color: "#00c896", icon: <FileTextOutlined /> },
  http: { label: "HTTP", color: "#13c2c2", icon: <ApiOutlined /> },
};

const MODULE_COLOR = "#eb2f96";

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

export default function SkillsView({
  initialSkills,
  initialRuns,
}: {
  initialSkills: SkillRecord[];
  initialRuns: RunItem[];
}) {
  const { message } = App.useApp();
  const [skills, setSkills] = useState<SkillRecord[]>(initialSkills);
  const [filter, setFilter] = useState<"all" | SkillType>("all");
  const [selected, setSelected] = useState<SkillRecord | null>(null);
  const [drawerRuns, setDrawerRuns] = useState<RunItem[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [runLog, setRunLog] = useState<RunItem[]>(initialRuns);
  const [form] = Form.useForm();

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: skills.length, shell: 0, prompt: 0, http: 0 };
    for (const s of skills) c[s.type] = (c[s.type] || 0) + 1;
    return c;
  }, [skills]);

  /** 静默刷新：管理后台增删技能后，工作台无需手动刷新即可同步 */
  const refresh = useCallback(async () => {
    try {
      const [list, runs] = await Promise.all([
        fetch("/api/skills").then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch("/api/runs?limit=10").then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ]);
      if (list?.skills) {
        const next: SkillRecord[] = list.skills;
        setSkills(next);
        // 选中的技能已被删除 → 自动收起抽屉；否则以最新数据替换（运行次数等实时更新）
        setSelected((prev) => (prev ? next.find((s) => s.id === prev.id) ?? null : null));
      }
      if (runs?.runs) setRunLog(runs.runs);
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

  const filtered = useMemo(
    () => (filter === "all" ? skills : skills.filter((s) => s.type === filter)),
    [skills, filter]
  );

  async function openSkill(s: SkillRecord) {
    setSelected(s);
    setResult(null);
    const defaults: Record<string, string> = {};
    for (const p of s.params) if (p.default !== undefined) defaults[p.name] = p.default;
    form.resetFields();
    form.setFieldsValue(defaults);
    setDrawerRuns([]);
    setRunsLoading(true);
    try {
      const res = await fetch(`/api/skills/${s.id}`);
      if (res.ok) {
        const data = await res.json();
        setDrawerRuns(data.runs || []);
      }
    } catch {
      /* 历史加载失败不阻塞抽屉 */
    } finally {
      setRunsLoading(false);
    }
  }

  async function doRun() {
    if (!selected) return;
    const values = (await form.validateFields()) as Record<string, string>;
    setRunning(true);
    setResult(null);
    try {
      const res = await fetch(`/api/skills/${selected.id}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ params: values }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "执行失败");
      setResult(data);
      // 刷新抽屉内历史
      const detail = await fetch(`/api/skills/${selected.id}`)
        .then((r) => r.json())
        .catch(() => null);
      if (detail?.runs) setDrawerRuns(detail.runs);
      // 更新页面级最近执行与卡片状态
      const nowLocal = new Date();
      const p = (n: number) => String(n).padStart(2, "0");
      const startedAt = `${nowLocal.getFullYear()}-${p(nowLocal.getMonth() + 1)}-${p(nowLocal.getDate())} ${p(
        nowLocal.getHours()
      )}:${p(nowLocal.getMinutes())}:${p(nowLocal.getSeconds())}`;
      setRunLog((prev) =>
        [
          {
            id: data.runId,
            skill_id: selected.id,
            skill_name: selected.displayName || selected.name,
            status: data.status,
            duration_ms: data.durationMs,
            triggered_by: "我",
            started_at: startedAt,
          } as RunItem,
          ...prev,
        ].slice(0, 10)
      );
      setSkills((prev) =>
        prev.map((s) =>
          s.id === selected.id
            ? { ...s, runCount: s.runCount + 1, lastRunAt: startedAt, lastRunStatus: data.status }
            : s
        )
      );
      if (data.status === "success") message.success(`执行成功（${fmtDuration(data.durationMs)}）`);
      else message.warning("执行完成，但返回了失败状态");
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  const filters: { key: "all" | SkillType; label: string; color: string; icon: ReactNode }[] = [
    { key: "all", label: "全部", color: MODULE_COLOR, icon: <ThunderboltFilled /> },
    ...Object.entries(TYPE_META).map(([k, m]) => ({
      key: k as SkillType,
      label: m.label,
      color: m.color,
      icon: m.icon,
    })),
  ];

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
            <ThunderboltFilled />
          </Avatar>
          <div>
            <Typography.Title level={4} style={{ margin: 0 }}>
              技能
            </Typography.Title>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              选择技能，填写参数并运行。
            </Typography.Text>
          </div>
        </Space>
      </div>

      {/* 类型筛选 */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {filters.map((f) => {
          const active = filter === f.key;
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "5px 14px",
                borderRadius: 999,
                cursor: "pointer",
                border: `1px solid ${active ? f.color : "#e4e7ec"}`,
                background: active ? f.color : "#fff",
                color: active ? "#fff" : "#595959",
                fontSize: 13,
                fontWeight: active ? 600 : 400,
                transition: "all .2s",
              }}
            >
              {f.icon}
              {f.label}
              <span style={{ opacity: 0.75, fontSize: 12 }}>{counts[f.key] ?? 0}</span>
            </button>
          );
        })}
      </div>

      {/* 技能卡片 */}
      {filtered.length === 0 ? (
        <Card style={{ borderRadius: 8 }}>
          <Empty
            description="没有符合条件的技能。可切换筛选条件，或联系管理员添加。"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        </Card>
      ) : (
        <Row gutter={[16, 16]} align="stretch">
          {filtered.map((s) => {
            const meta = TYPE_META[s.type];
            const color = s.color || meta.color;
            return (
              <Col xs={24} sm={12} lg={8} key={s.id} style={{ display: "flex" }}>
                <Card
                  hoverable
                  style={{ height: "100%", borderRadius: 8, borderColor: "#e2e7ec" }}
                  onClick={() => openSkill(s)}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <Avatar size={44} style={{ background: gradient(color), fontSize: 20 }}>
                      {meta.icon}
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
                        {s.displayName}
                      </div>
                      <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                        {s.name}
                      </Typography.Text>
                    </div>
                    <Space
                      size={4}
                      style={{ flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end", maxWidth: "55%" }}
                    >
                      <Tag color={color} style={{ margin: 0 }}>
                        {meta.label}
                      </Tag>
                      <VisibilityTag value={s.visibility} style={{ margin: 0 }} />
                      <SourceTag source={s.source} />
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
                    {s.description || "暂无描述"}
                  </p>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginTop: 12,
                    }}
                  >
                    <Space size={8} style={{ fontSize: 11, color: "#8c8c8c" }}>
                      {s.params.length > 0 && <span>{s.params.length} 个参数</span>}
                      <span>已执行 {s.runCount} 次</span>
                    </Space>
                    {s.lastRunStatus ? (
                      s.lastRunStatus === "success" ? (
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
            );
          })}
        </Row>
      )}

      {/* 最近执行 */}
      <Card
        style={{ borderRadius: 8 }}
        title={
          <Space>
            <HistoryOutlined style={{ color: "#fa8c16" }} />
            <span>最近执行</span>
          </Space>
        }
      >
        {runLog.length === 0 ? (
          <Empty description="还没有执行记录，点开一个技能试试" image={Empty.PRESENTED_IMAGE_SIMPLE} />
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
                  {r.skill_name}
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
        width={620}
        title={
          selected ? (
            <Space>
              <Avatar
                size={30}
                style={{
                  background: gradient(selected.color || TYPE_META[selected.type].color),
                  fontSize: 14,
                }}
              >
                {TYPE_META[selected.type].icon}
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

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
              <Tag color={TYPE_META[selected.type].color}>{TYPE_META[selected.type].label} 技能</Tag>
              <VisibilityTag value={selected.visibility} />
              <SourceTag source={selected.source} />
              <Tag>{selected.params.length} 个参数</Tag>
              <Tag>已执行 {selected.runCount} 次</Tag>
              {selected.lastRunAt && (
                <Tag icon={<ClockCircleOutlined />}>上次 {fmtTime(selected.lastRunAt)}</Tag>
              )}
            </div>

            {/* 执行区 */}
            <Typography.Title level={5} style={{ marginTop: 0 }}>
              执行
            </Typography.Title>
            {selected.params.length === 0 ? (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                该技能无需参数，直接执行即可。
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
                        {p.multiline && (
                          <Tag style={{ margin: 0, fontSize: 10 }}>多行</Tag>
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
              执行技能
            </Button>

            {/* 执行结果 */}
            {result && (
              <Card size="small" style={{ marginTop: 16, borderRadius: 10, background: "#fafafa" }}>
                <Space style={{ marginBottom: 8 }}>
                  <Tag color={result.status === "success" ? "success" : "error"}>
                    {result.status === "success" ? "成功" : "失败"}
                  </Tag>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    耗时 {fmtDuration(result.durationMs)}
                  </Typography.Text>
                </Space>
                {result.error && (
                  <Typography.Paragraph type="danger" style={{ marginBottom: 6 }}>
                    {result.error}
                  </Typography.Paragraph>
                )}
                <div style={{ marginTop: 4 }}>
                  <RunOutput output={result.output || ""} />
                </div>
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
              <Empty description="暂无执行记录" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              <div style={{ display: "grid" }}>
                {drawerRuns.map((r) => (
                  <div
                    key={r.id}
                    onClick={() =>
                      setResult({
                        runId: r.id,
                        status: r.status as "success" | "failed",
                        output: r.output || "",
                        error: r.error || "",
                        durationMs: r.duration_ms || 0,
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
                      查看 skill.yml 定义
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
