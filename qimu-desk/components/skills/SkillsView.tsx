"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Alert,
  App,
  Avatar,
  Button,
  Collapse,
  Drawer,
  Empty,
  Form,
  Input,
  Pagination,
  Select,
  Space,
  Spin,
  Tabs,
  Tag,
  Typography,
} from "antd";
import {
  ApiOutlined,
  ArrowRightOutlined,
  CheckCircleFilled,
  ClockCircleOutlined,
  CloseCircleFilled,
  CodeOutlined,
  FileTextOutlined,
  HistoryOutlined,
  PlayCircleFilled,
  ReloadOutlined,
  SearchOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import type { SkillType, RunItem, SkillRecord, RunResult } from "@/core/skills";
import SourceTag from "@/components/SourceTag";
import VisibilityTag from "@/components/VisibilityTag";
import RunOutput from "@/components/skills/RunOutput";
import YamlBlock from "@/components/skills/YamlBlock";
import styles from "./SkillsView.module.css";

export const TYPE_META: Record<
  SkillType,
  { label: string; color: string; icon: ReactNode; description: string }
> = {
  shell: {
    label: "Shell",
    color: "#527a62",
    icon: <CodeOutlined />,
    description: "运行脚本与命令",
  },
  prompt: {
    label: "Prompt",
    color: "#345d88",
    icon: <FileTextOutlined />,
    description: "通过 AI 生成内容",
  },
  http: {
    label: "HTTP",
    color: "#457e89",
    icon: <ApiOutlined />,
    description: "调用接口与服务",
  },
};
const PAGE_SIZE = 12;

function fmtTime(s?: string | null) {
  if (!s) return "尚未执行";
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(s);
  return m ? `${m[2]}-${m[3]} ${m[4]}:${m[5]}` : s;
}
function fmtDuration(ms?: number | null) {
  return ms == null
    ? "—"
    : ms >= 1000
      ? `${(ms / 1000).toFixed(1)}s`
      : `${ms}ms`;
}
function RunStatus({ status }: { status?: string | null }) {
  if (status === "success")
    return (
      <span className={styles.success}>
        <CheckCircleFilled /> 成功
      </span>
    );
  if (status === "failed")
    return (
      <span className={styles.failed}>
        <CloseCircleFilled /> 失败
      </span>
    );
  return (
    <span className={styles.muted}>
      <ClockCircleOutlined /> {status ? "执行中" : "未执行"}
    </span>
  );
}
async function readResponse(res: Response) {
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "加载失败，请重试");
  return data;
}

export default function SkillsView({
  initialSkills,
  initialRuns,
}: {
  initialSkills: SkillRecord[];
  initialRuns: RunItem[];
}) {
  const { message } = App.useApp();
  const [skills, setSkills] = useState(initialSkills);
  const [runLog, setRunLog] = useState(initialRuns);
  const [filter, setFilter] = useState<"all" | SkillType>("all");
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState("all");
  const [sort, setSort] = useState("recent");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<SkillRecord | null>(null);
  const [drawerRuns, setDrawerRuns] = useState<RunItem[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [refreshError, setRefreshError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [tab, setTab] = useState("execute");
  const [form] = Form.useForm<Record<string, string>>();
  const detailRequest = useRef(0);
  const refreshLock = useRef(false);
  const runLock = useRef(false);

  const refresh = useCallback(
    async (manual = false) => {
      if (refreshLock.current || runLock.current) return;
      refreshLock.current = true;
      if (manual) setRefreshing(true);
      try {
        const [list, runs] = await Promise.all([
          fetch("/api/skills", { cache: "no-store" }).then(readResponse),
          fetch("/api/runs?limit=10", { cache: "no-store" }).then(readResponse),
        ]);
        setSkills(list.skills);
        setRunLog(runs.runs);
        setRefreshError("");
        if (manual) message.success("技能库已更新");
      } catch (e) {
        setRefreshError((e as Error).message || "刷新失败，请重试");
      } finally {
        refreshLock.current = false;
        setRefreshing(false);
      }
    },
    [message],
  );

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const id = setInterval(tick, 10_000);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("focus", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener("focus", tick);
      detailRequest.current++;
    };
  }, [refresh]);

  const counts = useMemo(
    () => ({
      all: skills.length,
      shell: skills.filter((s) => s.type === "shell").length,
      prompt: skills.filter((s) => s.type === "prompt").length,
      http: skills.filter((s) => s.type === "http").length,
    }),
    [skills],
  );
  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return skills
      .filter(
        (s) =>
          (filter === "all" || s.type === filter) &&
          (scope === "all" || (s.visibility || "public") === scope) &&
          (!term ||
            `${s.displayName} ${s.name} ${s.description}`
              .toLocaleLowerCase()
              .includes(term)),
      )
      .sort((a, b) => {
        if (sort === "name")
          return (
            a.displayName.localeCompare(b.displayName, "zh-CN") || a.id - b.id
          );
        if (sort === "popular") return b.runCount - a.runCount || a.id - b.id;
        return (
          (b.lastRunAt || "").localeCompare(a.lastRunAt || "") || a.id - b.id
        );
      });
  }, [skills, filter, query, scope, sort]);
  const currentPage = Math.min(
    page,
    Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)),
  );
  const shown = filtered.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );
  const hasFilters = !!query || filter !== "all" || scope !== "all";

  function resetFilters() {
    setQuery("");
    setFilter("all");
    setScope("all");
    setPage(1);
  }
  function resetParams(skill: SkillRecord) {
    form.resetFields();
    form.setFieldsValue(
      Object.fromEntries(skill.params.map((p) => [p.name, p.default ?? ""])),
    );
  }
  async function loadDetail(skill: SkillRecord, runId?: number) {
    const request = ++detailRequest.current;
    setRunsLoading(true);
    setDetailError("");
    try {
      const data = await fetch(`/api/skills/${skill.id}`, {
        cache: "no-store",
      }).then(readResponse);
      if (request !== detailRequest.current) return;
      setSelected(data.skill);
      setDrawerRuns(data.runs || []);
      if (runId !== undefined) {
        const run = (data.runs as RunItem[]).find((r) => r.id === runId);
        if (run) showRun(run);
        else {
          setTab("history");
          message.info("该记录已不在最近 10 次执行中，请选择其他记录。");
        }
      }
    } catch (e) {
      if (request === detailRequest.current)
        setDetailError((e as Error).message);
    } finally {
      if (request === detailRequest.current) setRunsLoading(false);
    }
  }
  function openSkill(skill: SkillRecord, runId?: number) {
    if (runLock.current) return;
    setSelected(skill);
    setResult(null);
    setTab(runId === undefined ? "execute" : "history");
    setDrawerRuns([]);
    resetParams(skill);
    void loadDetail(skill, runId);
  }
  function showRun(run: RunItem) {
    if (run.status !== "success" && run.status !== "failed") return;
    setResult({
      runId: run.id,
      status: run.status,
      output: run.output || "",
      error: run.error || "",
      durationMs: run.duration_ms || 0,
    });
    setTab("result");
  }
  async function doRun() {
    if (!selected || runLock.current) return;
    runLock.current = true;
    let values: Record<string, string>;
    try {
      values = await form.validateFields();
    } catch {
      runLock.current = false;
      return;
    }
    setRunning(true);
    setResult(null);
    setTab("result");
    try {
      const data: RunResult = await fetch(`/api/skills/${selected.id}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ params: values }),
      }).then(readResponse);
      setResult(data);
      setTab("result");
      message[data.status === "success" ? "success" : "warning"](
        data.status === "success" ? "技能执行成功" : "技能执行失败，请查看结果",
      );
      await loadDetail(selected);
    } catch (e) {
      message.error(
        (e as Error).message || "执行请求失败，请查看运行历史后再重试",
      );
    } finally {
      runLock.current = false;
      setRunning(false);
      void refresh();
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div>
          <div className={styles.eyebrow}>工作台 / 自动化</div>
          <h1>
            技能库 <span>{skills.length}</span>
          </h1>
          <p>把重复工作交给技能，专注于下一步。</p>
        </div>
        <Button
          icon={<ReloadOutlined />}
          loading={refreshing}
          disabled={running}
          onClick={() => void refresh(true)}
        >
          刷新技能
        </Button>
      </header>
      {refreshError && (
        <Alert
          type="warning"
          showIcon
          title="技能库暂未更新，正在展示上次加载的数据"
          description={refreshError}
          action={
            <Button size="small" onClick={() => void refresh(true)}>
              重试
            </Button>
          }
        />
      )}
      <div className={styles.layout}>
        <section className={styles.library} aria-label="技能库">
          <div className={styles.typeNav} aria-label="技能类型">
            {(["all", "shell", "prompt", "http"] as const).map((key) => {
              const meta =
                key === "all"
                  ? {
                      label: "全部技能",
                      icon: <ThunderboltOutlined />,
                      description: "浏览所有可用技能",
                    }
                  : TYPE_META[key];
              return (
                <button
                  type="button"
                  key={key}
                  aria-pressed={filter === key}
                  className={`${styles.typeButton} ${filter === key ? styles.active : ""}`}
                  onClick={() => {
                    setFilter(key);
                    setPage(1);
                  }}
                >
                  <span className={styles.typeLabel}>
                    {meta.icon}
                    <strong>{meta.label}</strong>
                    <b>{counts[key]}</b>
                  </span>
                  <small>{meta.description}</small>
                </button>
              );
            })}
          </div>
          <div className={styles.toolbar}>
            <Input
              aria-label="搜索技能"
              prefix={<SearchOutlined />}
              placeholder="搜索名称、标识或描述"
              value={query}
              allowClear
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
              className={styles.search}
            />
            <Select
              aria-label="可见范围"
              value={scope}
              onChange={(v) => {
                setScope(v);
                setPage(1);
              }}
              options={[
                { value: "all", label: "全部范围" },
                { value: "personal", label: "个人技能" },
                { value: "public", label: "通用技能" },
              ]}
            />
            <Select
              aria-label="技能排序"
              value={sort}
              onChange={(v) => {
                setSort(v);
                setPage(1);
              }}
              options={[
                { value: "recent", label: "最近执行" },
                { value: "popular", label: "使用最多" },
                { value: "name", label: "名称排序" },
              ]}
            />
          </div>
          <div className={styles.listHeading}>
            <span>
              {hasFilters ? "筛选结果" : "可用技能"} · {filtered.length} 项
            </span>
            {hasFilters && (
              <Button type="link" size="small" onClick={resetFilters}>
                清除筛选
              </Button>
            )}
          </div>
          {shown.length ? (
            <div className={styles.grid}>
              {shown.map((skill) => {
                const meta = TYPE_META[skill.type];
                return (
                  <article key={skill.id} className={styles.card}>
                    <div className={styles.cardHeading}>
                      <Avatar
                        shape="square"
                        size={42}
                        style={{ background: "#eff3f6", color: meta.color }}
                      >
                        {meta.icon}
                      </Avatar>
                      <div>
                        <h2>{skill.displayName || skill.name}</h2>
                        <code>{skill.name}</code>
                      </div>
                      <span
                        className={styles.typeTag}
                        style={{ color: meta.color }}
                      >
                        {meta.label}
                      </span>
                    </div>
                    <p className={styles.description}>
                      {skill.description ||
                        "暂无描述，打开技能查看参数与执行方式。"}
                    </p>
                    <div className={styles.tags}>
                      <VisibilityTag value={skill.visibility} />
                      <SourceTag source={skill.source} />
                      <span>
                        {skill.params.length
                          ? `${skill.params.length} 个参数`
                          : "无需参数"}
                      </span>
                    </div>
                    <div className={styles.cardMeta}>
                      <span>已执行 {skill.runCount} 次</span>
                      <RunStatus status={skill.lastRunStatus} />
                    </div>
                    <div className={styles.cardFooter}>
                      <span>{fmtTime(skill.lastRunAt)}</span>
                      <Button
                        type="text"
                        onClick={() => openSkill(skill)}
                        aria-label={`打开技能：${skill.displayName || skill.name}`}
                      >
                        打开技能 <ArrowRightOutlined />
                      </Button>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className={styles.empty}>
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  skills.length
                    ? "没有找到符合条件的技能"
                    : "技能库暂时为空，联系管理员添加技能后刷新。"
                }
              />
              {hasFilters && <Button onClick={resetFilters}>清除筛选</Button>}
            </div>
          )}
          {filtered.length > PAGE_SIZE && (
            <Pagination
              className={styles.pagination}
              current={currentPage}
              pageSize={PAGE_SIZE}
              total={filtered.length}
              onChange={setPage}
              showSizeChanger={false}
            />
          )}
        </section>
        <aside className={styles.aside}>
          <section className={styles.historyPanel}>
            <div className={styles.panelHeading}>
              <h2>
                <HistoryOutlined /> 最近执行
              </h2>
              <span>最近 {runLog.length} 次</span>
            </div>
            {runLog.length ? (
              <div>
                {runLog.map((run) => {
                  const skill = skills.find((s) => s.id === run.skill_id);
                  return (
                    <button
                      type="button"
                      key={run.id}
                      className={styles.runRow}
                      disabled={!skill || running}
                      onClick={() => skill && openSkill(skill, run.id)}
                      aria-label={`查看执行结果：${run.skill_name}`}
                    >
                      <div>
                        <strong>{run.skill_name}</strong>
                        <RunStatus status={run.status} />
                      </div>
                      <div>
                        <span>{fmtTime(run.started_at)}</span>
                        <span>{fmtDuration(run.duration_ms)}</span>
                      </div>
                      <small>
                        {run.triggered_by || "未知执行人"}
                        {skill ? " · 查看结果 →" : " · 技能不可用"}
                      </small>
                    </button>
                  );
                })}
              </div>
            ) : (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="执行技能后，记录会显示在这里"
              />
            )}
          </section>
          <div className={styles.guide}>
            <ThunderboltOutlined />
            <div>
              <strong>从一次执行开始</strong>
              <p>
                打开技能，确认参数后执行。在独立的执行结果页签查看输出，也可从运行历史重新打开。
              </p>
            </div>
          </div>
        </aside>
      </div>
      <Drawer
        open={!!selected}
        onClose={() => {
          if (runLock.current) return;
          detailRequest.current++;
          setSelected(null);
        }}
        size={680}
        closable={!running}
        mask={{ closable: !running }}
        keyboard={!running}
        title={selected?.displayName || selected?.name}
      >
        {selected && (
          <div className={styles.detail}>
            <Typography.Text type="secondary" copyable>
              {selected.name}
            </Typography.Text>
            <p>{selected.description || "暂无描述"}</p>
            <Space wrap>
              <Tag>{TYPE_META[selected.type].label}</Tag>
              <VisibilityTag value={selected.visibility} />
              <SourceTag source={selected.source} />
              <Typography.Text type="secondary">
                已执行 {selected.runCount} 次
              </Typography.Text>
            </Space>
            {detailError && (
              <Alert
                type="warning"
                showIcon
                title={detailError}
                action={
                  <Button
                    size="small"
                    disabled={running}
                    onClick={() => void loadDetail(selected)}
                  >
                    重试
                  </Button>
                }
              />
            )}
            <Tabs
              activeKey={tab}
              onChange={setTab}
              items={[
                {
                  key: "execute",
                  label: "参数与执行",
                  children: (
                    <>
                      <div className={styles.executionHeading}>
                        <h3>执行参数</h3>
                        <Button
                          type="link"
                          size="small"
                          disabled={running || runsLoading}
                          onClick={() => resetParams(selected)}
                        >
                          恢复默认值
                        </Button>
                      </div>
                      <Form
                        form={form}
                        layout="vertical"
                        disabled={running || runsLoading}
                        preserve={false}
                      >
                        {selected.params.length === 0 && (
                          <p className={styles.noParams}>
                            此技能无需填写参数，可直接执行。
                          </p>
                        )}
                        {selected.params.map((p) => (
                          <Form.Item
                            key={p.name}
                            name={p.name}
                            label={p.label || p.name}
                            initialValue={p.default ?? ""}
                            extra={p.description}
                            rules={[
                              {
                                required: p.required,
                                whitespace: true,
                                message: `请填写${p.label || p.name}`,
                              },
                            ]}
                          >
                            {p.multiline ? (
                              <Input.TextArea
                                autoSize={{ minRows: 3, maxRows: 8 }}
                                placeholder={`输入${p.label || p.name}`}
                              />
                            ) : (
                              <Input
                                allowClear
                                placeholder={`输入${p.label || p.name}`}
                              />
                            )}
                          </Form.Item>
                        ))}
                      </Form>
                      <Button
                        type="primary"
                        icon={<PlayCircleFilled />}
                        loading={running}
                        disabled={runsLoading || !!detailError}
                        block
                        size="large"
                        onClick={() => void doRun()}
                      >
                        {running ? "正在执行，请稍候…" : "执行技能"}
                      </Button>
                    </>
                  ),
                },
                {
                  key: "result",
                  label: "执行结果",
                  children: (
                    <section className={styles.result} aria-live="polite">
                      <div className={styles.executionHeading}>
                        <h3>
                          {result ? `执行结果 #${result.runId}` : "执行结果"}
                        </h3>
                        {result && (
                          <Typography.Text
                            copyable={{ text: result.output || result.error }}
                          >
                            复制结果
                          </Typography.Text>
                        )}
                      </div>
                      {running ? (
                        <div className={styles.resultEmpty}>
                          <Spin />
                          <p>正在处理，结果将在完成后显示。</p>
                        </div>
                      ) : result ? (
                        <>
                          <div className={styles.resultMeta}>
                            <RunStatus status={result.status} />
                            <span>耗时 {fmtDuration(result.durationMs)}</span>
                          </div>
                          {result.error && (
                            <Alert
                              type="error"
                              title={result.error}
                              showIcon
                            />
                          )}
                          <RunOutput
                            key={result.runId}
                            output={result.output || ""}
                            maxHeight={600}
                          />
                        </>
                      ) : (
                        <p className={styles.resultEmpty}>
                          执行技能或选择历史记录后，在这里查看结果。
                        </p>
                      )}
                    </section>
                  ),
                },
                {
                  key: "history",
                  label: `运行历史${drawerRuns.length ? ` (${drawerRuns.length})` : ""}`,
                  disabled: running,
                  children: runsLoading ? (
                    <div className={styles.resultEmpty}>
                      <Spin />
                    </div>
                  ) : drawerRuns.length ? (
                    <div>
                      <p className={styles.muted}>
                        最近 10 次执行，点击记录查看输出。
                      </p>
                      {drawerRuns.map((run) => (
                        <button
                          type="button"
                          key={run.id}
                          className={styles.detailRun}
                          disabled={
                            run.status !== "success" && run.status !== "failed"
                          }
                          onClick={() => showRun(run)}
                        >
                          <RunStatus status={run.status} />
                          <span>{fmtTime(run.started_at)}</span>
                          <span>{fmtDuration(run.duration_ms)}</span>
                          <span>{run.triggered_by || "—"}</span>
                          <ArrowRightOutlined />
                        </button>
                      ))}
                    </div>
                  ) : (
                    <Empty
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description="暂无执行记录"
                    />
                  ),
                },
                {
                  key: "definition",
                  label: "技能定义",
                  disabled: running,
                  children: (
                    <>
                      <p className={styles.muted}>
                        查看技能配置，了解它的执行方式。
                      </p>
                      {selected.sourceText ? (
                        <YamlBlock
                          source={selected.sourceText}
                          maxHeight={520}
                        />
                      ) : (
                        <Collapse
                          defaultActiveKey={["config"]}
                          items={[
                            {
                              key: "config",
                              label: "执行配置",
                              children: (
                                <pre className={styles.config}>
                                  {JSON.stringify(selected.config, null, 2)}
                                </pre>
                              ),
                            },
                          ]}
                        />
                      )}
                    </>
                  ),
                },
              ]}
            />
          </div>
        )}
      </Drawer>
    </div>
  );
}
