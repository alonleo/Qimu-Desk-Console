"use client";
import { useEffect, useMemo, useState, type Key } from "react";
import { useRouter } from "next/navigation";
import {
  App,
  Button,
  Drawer,
  Empty,
  Form,
  Input,
  Popconfirm,
  Progress,
  Segmented,
  Select,
  Space,
  Table,
  Tag,
} from "antd";
import {
  PlusOutlined,
  SearchOutlined,
  LeftOutlined,
  RightOutlined,
} from "@ant-design/icons";
import {
  type Task,
  type Project,
  type Member,
  type Actor,
  type Filters,
  type TaskStatus,
  statuses,
  priorities,
  dateKey,
  overdue,
  dueOn,
  canManage,
  canStatus,
  initialFilters,
  filterTasks,
} from "./task-model";

type Props = {
  tasks: Task[];
  projects: Project[];
  members: Member[];
  actor: Actor;
  demo?: boolean;
  mode?: "desk" | "console";
};
type Values = {
  title: string;
  notes?: string;
  projectId?: number;
  assigneeId?: number;
  status: TaskStatus;
  priority: Task["priority"];
  period?: string;
  startDate?: string;
  dueDate?: string;
  visibility: string;
};
export default function TaskWorkspace({
  tasks,
  projects,
  members,
  actor,
  demo = false,
  mode = "desk",
}: Props) {
  const router = useRouter(),
    { message } = App.useApp();
  const [items, setItems] = useState(tasks),
    [filters, setFilters] = useState<Filters>(initialFilters),
    [view, setView] = useState("list"),
    [selection, setSelection] = useState<Key[]>([]),
    [busy, setBusy] = useState(false),
    [open, setOpen] = useState(false),
    [editing, setEditing] = useState<Task | null>(null),
    [form] = Form.useForm<Values>();
  const [now, setNow] = useState(() => new Date()),
    [month, setMonth] = useState(() => dateKey(new Date()).slice(0, 7)),
    [selectedDay, setSelectedDay] = useState<string | null>(null),
    [bulkStatus, setBulkStatus] = useState<TaskStatus>("done"),
    [bulkAssignee, setBulkAssignee] = useState<number | "none">("none");
  const period = Form.useWatch("period", form),
    visibility = Form.useWatch("visibility", form);
  useEffect(() => {
    setItems(tasks);
    setSelection((prev) => prev.filter((id) => tasks.some((t) => t.id === id)));
  }, [tasks]);
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);
  const filtered = useMemo(
    () => filterTasks(items, filters, actor, now),
    [items, filters, actor, now],
  );
  const counts = {
    open: items.filter((t) => t.status !== "done").length,
    overdue: items.filter((t) => overdue(t, now)).length,
    assigned: items.filter(
      (t) => t.assignee_id === actor.id && t.status !== "done",
    ).length,
    done: items.filter((t) => t.status === "done").length,
  };
  const selected = items.filter((t) => selection.includes(t.id));
  const manageable =
    selected.length > 0 && selected.every((t) => canManage(actor, t));
  const writable = !editing || canManage(actor, editing);
  const option = (record: Record<string, string>) =>
    Object.entries(record).map(([value, label]) => ({ value, label }));
  function filter(key: keyof Filters, value: string) {
    setFilters((p) => ({ ...p, [key]: value }));
    setSelection([]);
    setSelectedDay(null);
  }
  function reset() {
    setFilters(initialFilters);
    setSelection([]);
    setSelectedDay(null);
  }
  async function request(path: string, method: string, body?: unknown) {
    const res = await fetch("/api/tasks" + path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res
      .json()
      .catch(() => ({ error: "服务返回异常，请重试" }));
    if (!res.ok || data.ok === false || data.error)
      throw new Error(data.error || "操作失败，请重试");
    return data;
  }
  async function refresh() {
    const res = await fetch("/api/tasks", { cache: "no-store" });
    if (!res.ok) throw new Error("操作已提交，但列表刷新失败，请刷新页面");
    const d = await res.json();
    setItems(Array.isArray(d) ? d : d.tasks);
    router.refresh();
  }
  function applyDemo(task: Task, patch: Record<string, unknown>): Task {
    const mapping: Record<string, string> = {
      projectId: "project_id",
      assigneeId: "assignee_id",
      startDate: "start_date",
      dueDate: "due_date",
    };
    const next = { ...task };
    for (const [k, v] of Object.entries(patch))
      (next as unknown as Record<string, unknown>)[mapping[k] || k] = v;
    next.project_name = projects.find((p) => p.id === next.project_id)?.name;
    next.assignee_name = members.find((m) => m.id === next.assignee_id)?.name;
    return next;
  }
  async function mutate(
    path: string,
    method: string,
    body?: Record<string, unknown>,
  ) {
    setBusy(true);
    try {
      if (demo) {
        setItems((prev) =>
          method === "DELETE"
            ? prev.filter((t) => t.id !== Number(path.slice(1)))
            : method === "POST"
              ? [
                  ...prev,
                  applyDemo(
                    {
                      id: Date.now(),
                      title: "",
                      notes: null,
                      status: "todo",
                      priority: "normal",
                      project_id: null,
                      due_date: null,
                      owner_id: actor.id,
                      visibility:
                        actor.role === "admin" ? "public" : "personal",
                    },
                    body || {},
                  ),
                ]
              : prev.map((t) =>
                  t.id === Number(path.slice(1)) ? applyDemo(t, body || {}) : t,
                ),
        );
      } else {
        await request(path, method, body);
        await refresh();
      }
      message.success(demo ? "演示数据已更新（刷新页面后还原）" : "任务已更新");
      return true;
    } catch (e) {
      message.error((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  function show(task: Task | null = null) {
    setEditing(task);
    form.resetFields();
    form.setFieldsValue(
      task
        ? {
            title: task.title,
            notes: task.notes || "",
            projectId: task.project_id ?? undefined,
            assigneeId: task.assignee_id ?? undefined,
            status: task.status,
            priority: task.priority,
            period: task.period || "",
            startDate: task.start_date || "",
            dueDate: task.due_date || "",
            visibility: task.visibility || "public",
          }
        : {
            title: "",
            status: "todo",
            priority: "normal",
            period: "",
            visibility: actor.role === "admin" ? "public" : "personal",
            projectId:
              filters.project !== "all" && filters.project !== "none"
                ? Number(filters.project)
                : undefined,
          },
    );
    setOpen(true);
  }
  async function save(values: Values) {
    if (
      values.startDate &&
      values.dueDate &&
      values.startDate > values.dueDate
    ) {
      message.error("开始时间不能晚于截止时间");
      return;
    }
    if (
      values.visibility === "personal" &&
      values.assigneeId &&
      values.assigneeId !== (editing?.owner_id ?? actor.id)
    ) {
      message.error("分配给其他成员前，请将任务设为团队可见");
      return;
    }
    const body = {
      ...values,
      title: values.title.trim(),
      projectId: values.projectId ?? null,
      assigneeId: values.assigneeId ?? null,
      period: values.period || null,
      startDate: values.startDate || null,
      dueDate: values.dueDate || null,
      notes: values.notes || null,
    };
    if (
      await mutate(
        editing ? "/" + editing.id : "",
        editing ? "PATCH" : "POST",
        body,
      )
    )
      setOpen(false);
  }
  async function bulk(patch: Record<string, unknown> | null) {
    if (selection.length > 100) {
      message.warning("每次最多操作 100 项");
      return;
    }
    setBusy(true);
    try {
      if (demo) {
        setItems((prev) =>
          patch
            ? prev.map((t) =>
                selection.includes(t.id) ? applyDemo(t, patch) : t,
              )
            : prev.filter((t) => !selection.includes(t.id)),
        );
        setSelection([]);
        message.success("演示任务已更新");
      } else {
        const data = await request(
          patch ? "/batch-update" : "/batch-delete",
          "POST",
          patch ? { ids: selection, data: patch } : { ids: selection },
        );
        await refresh();
        const failed = (data.errors || []) as {
          id: number;
          error?: string;
          message?: string;
        }[];
        setSelection(failed.map((e) => e.id));
        if (failed.length)
          message.warning(
            `部分任务未更新：${failed.map((e) => `#${e.id} ${e.error || e.message || "操作失败"}`).join("；")}`,
          );
        else {
          setSelection([]);
          message.success("批量操作完成");
        }
      }
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const today = dateKey(now),
    [year, monthNumber] = month.split("-").map(Number),
    firstDay = new Date(year, monthNumber - 1, 1),
    offset = (firstDay.getDay() + 6) % 7;
  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(year, monthNumber - 1, 1 - offset + i);
    return {
      key: dateKey(d),
      day: d.getDate(),
      current: d.getMonth() === monthNumber - 1,
    };
  });
  function shiftMonth(delta: number) {
    setMonth(dateKey(new Date(year, monthNumber - 1 + delta, 1)).slice(0, 7));
    setSelectedDay(null);
  }
  function statusSelect(t: Task) {
    return (
      <Select
        aria-label={`${t.title}的状态`}
        size="small"
        value={t.status}
        disabled={busy || !canStatus(actor, t)}
        onChange={(status) => void mutate("/" + t.id, "PATCH", { status })}
        options={option(statuses)}
        style={{ width: 112 }}
      />
    );
  }
  function dateLabel(t: Task) {
    return (
      <span className={overdue(t, now) ? "task-overdue" : ""}>
        {t.due_date
          ? `${t.period === "daily" ? "每日 " : ""}${t.due_date}${overdue(t, now) ? " · 逾期" : ""}`
          : "未设置"}
      </span>
    );
  }
  const columns = [
    {
      title: "任务",
      key: "title",
      width: 270,
      render: (_: unknown, t: Task) => (
        <button className="task-title-button" onClick={() => show(t)}>
          <strong className={t.status === "done" ? "is-complete" : ""}>
            {t.title}
          </strong>
          <small>
            {t.project_name || "未关联项目"}
            {t.notes ? ` · ${t.notes}` : ""}
          </small>
        </button>
      ),
    },
    {
      title: "状态",
      key: "status",
      width: 130,
      render: (_: unknown, t: Task) => statusSelect(t),
    },
    {
      title: "优先级",
      key: "priority",
      width: 85,
      render: (_: unknown, t: Task) => (
        <Tag
          color={
            t.priority === "urgent"
              ? "red"
              : t.priority === "high"
                ? "orange"
                : undefined
          }
        >
          {priorities[t.priority]}
        </Tag>
      ),
    },
    {
      title: "负责人",
      key: "assignee",
      width: 110,
      render: (_: unknown, t: Task) =>
        t.assignee_name ||
        members.find((m) => m.id === t.assignee_id)?.name ||
        "未分配",
    },
    {
      title: "截止时间",
      key: "due",
      width: 155,
      render: (_: unknown, t: Task) => dateLabel(t),
    },
    {
      title: "可见范围",
      key: "visibility",
      width: 100,
      render: (_: unknown, t: Task) =>
        t.visibility === "personal" ? "仅自己" : "团队",
    },
    {
      title: "操作",
      key: "actions",
      width: 135,
      render: (_: unknown, t: Task) => (
        <Space>
          <Button type="link" size="small" onClick={() => show(t)}>
            {canManage(actor, t) ? "编辑" : "详情"}
          </Button>
          {canManage(actor, t) && (
            <Popconfirm
              title="删除这项任务？"
              description="删除后不可恢复。"
              onConfirm={() => mutate("/" + t.id, "DELETE")}
              okText="删除"
              cancelText="取消"
            >
              <Button type="text" danger size="small" disabled={busy}>
                删除
              </Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];
  return (
    <div className="task-workspace">
      <header className="overview-heading">
        <div>
          <span className="section-label">
            {mode === "desk" ? "日常工作" : "业务管理"} / 任务
          </span>
          <h1>{mode === "desk" ? "任务中心" : "任务管理"}</h1>
          <p>安排工作、明确分工，跟进每一个截止时间。</p>
        </div>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => show()}
          disabled={busy}
        >
          新建任务
        </Button>
      </header>
      {demo && (
        <div className="task-demo-notice">
          交互演示 ·
          可以新建、编辑和切换视图；所有操作仅保存在本页，不会修改线上数据。
        </div>
      )}
      <div className="task-stat-grid">
        {[
          { label: "未完成", value: counts.open, key: "all" },
          { label: "已逾期", value: counts.overdue, key: "overdue" },
          {
            label: "分配给我 · 未完成",
            value: counts.assigned,
            key: "assigned",
          },
          { label: "已完成", value: counts.done, key: "done" },
        ].map((c) => (
          <div key={c.key}>
            <span>{c.label}</span>
            <strong
              className={c.key === "overdue" && c.value ? "task-overdue" : ""}
            >
              {c.value}
            </strong>
          </div>
        ))}
      </div>
      <section className="task-controls" aria-label="任务筛选">
        <div className="task-toolbar">
          <Segmented
            value={filters.scope}
            onChange={(v) => filter("scope", v)}
            options={[
              { label: "全部可见", value: "all" },
              { label: "分配给我", value: "assigned" },
              { label: "我创建的", value: "created" },
            ]}
          />
          <Segmented
            value={view}
            onChange={setView}
            options={[
              { label: "列表", value: "list" },
              { label: "看板", value: "board" },
              { label: "日历", value: "calendar" },
              { label: "进度", value: "progress" },
            ]}
          />
        </div>
        <div className="task-filter-grid">
          <Input
            prefix={<SearchOutlined />}
            aria-label="搜索任务"
            placeholder="搜索标题或备注"
            allowClear
            value={filters.search}
            onChange={(e) => filter("search", e.target.value)}
          />
          <Select
            aria-label="项目筛选"
            value={filters.project}
            onChange={(v) => filter("project", v)}
            options={[
              { label: "全部项目", value: "all" },
              { label: "未关联项目", value: "none" },
              ...projects.map((p) => ({ label: p.name, value: String(p.id) })),
            ]}
          />
          <Select
            aria-label="负责人筛选"
            value={filters.assignee}
            onChange={(v) => filter("assignee", v)}
            options={[
              { label: "全部负责人", value: "all" },
              { label: "未分配", value: "none" },
              ...members.map((m) => ({ label: m.name, value: String(m.id) })),
            ]}
          />
          <Select
            aria-label="状态筛选"
            value={filters.status}
            onChange={(v) => filter("status", v)}
            options={[{ label: "全部状态", value: "all" }, ...option(statuses)]}
          />
          <Select
            aria-label="优先级筛选"
            value={filters.priority}
            onChange={(v) => filter("priority", v)}
            options={[
              { label: "全部优先级", value: "all" },
              ...option(priorities),
            ]}
          />
          <Select
            aria-label="截止日期筛选"
            value={filters.due}
            onChange={(v) => filter("due", v)}
            options={[
              { label: "全部截止时间", value: "all" },
              { label: "已逾期", value: "overdue" },
              { label: "今天截止", value: "today" },
              { label: "未设截止", value: "none" },
            ]}
          />
          <Select
            aria-label="任务排序"
            value={filters.sort}
            onChange={(v) => filter("sort", v)}
            options={[
              { label: "优先级排序", value: "priority" },
              { label: "截止时间排序", value: "due" },
              { label: "最新创建", value: "newest" },
            ]}
          />
          <Button onClick={reset}>重置筛选</Button>
        </div>
        <div className="task-result-count">
          显示 {filtered.length} / {items.length} 项任务 · 各视图共用当前筛选
        </div>
      </section>
      {view === "list" && (
        <section className="surface">
          <div className="task-bulk-bar">
            <span>已选择 {selection.length} 项</span>
            <Select
              aria-label="批量任务状态"
              value={bulkStatus}
              onChange={setBulkStatus}
              options={option(statuses)}
            />
            <Button
              disabled={
                busy ||
                !selected.length ||
                !selected.every((t) => canStatus(actor, t))
              }
              onClick={() => bulk({ status: bulkStatus })}
            >
              更新状态
            </Button>
            <Select
              aria-label="批量负责人"
              value={bulkAssignee}
              onChange={setBulkAssignee}
              options={[
                { label: "取消分配", value: "none" },
                ...members.map((m) => ({ label: m.name, value: m.id })),
              ]}
              style={{ minWidth: 120 }}
            />
            <Button
              disabled={busy || !manageable}
              onClick={() =>
                bulk({
                  assigneeId: bulkAssignee === "none" ? null : bulkAssignee,
                })
              }
            >
              分配负责人
            </Button>
            <Popconfirm
              title={`删除选中的 ${selection.length} 项任务？`}
              description="删除后不可恢复。"
              okText="删除"
              cancelText="取消"
              onConfirm={() => bulk(null)}
            >
              <Button danger disabled={busy || !manageable}>
                批量删除
              </Button>
            </Popconfirm>
            {selection.length > 0 && (
              <Button type="text" onClick={() => setSelection([])}>
                取消选择
              </Button>
            )}
          </div>
          <Table<Task>
            rowKey="id"
            dataSource={filtered}
            columns={columns}
            loading={busy}
            scroll={{ x: 1100 }}
            rowSelection={{
              selectedRowKeys: selection,
              onChange: setSelection,
              getCheckboxProps: (t) => ({
                disabled: busy || !canStatus(actor, t),
              }),
            }}
            pagination={{
              defaultPageSize: 10,
              showSizeChanger: true,
              pageSizeOptions: [10, 20, 50],
              showTotal: (n) => `共 ${n} 项`,
            }}
            locale={{
              emptyText: (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={
                    items.length
                      ? "没有符合筛选条件的任务"
                      : "还没有任务，点击右上角新建任务"
                  }
                />
              ),
            }}
          />
        </section>
      )}
      {view === "board" && (
        <div className="task-board">
          {Object.entries(statuses).map(([status, label]) => (
            <section className="task-board-column" key={status}>
              <h2>
                {label}
                <span>
                  {filtered.filter((t) => t.status === status).length}
                </span>
              </h2>
              {filtered
                .filter((t) => t.status === status)
                .map((t) => (
                  <article className="task-board-card" key={t.id}>
                    <button
                      className="task-title-button"
                      onClick={() => show(t)}
                    >
                      <strong>{t.title}</strong>
                      <small>{t.project_name || "未关联项目"}</small>
                    </button>
                    <div className="task-card-meta">
                      <Tag>{priorities[t.priority]}</Tag>
                      <span>
                        {t.assignee_name ||
                          members.find((m) => m.id === t.assignee_id)?.name ||
                          "未分配"}
                      </span>
                    </div>
                    <div className="task-card-date">{dateLabel(t)}</div>
                    {statusSelect(t)}
                  </article>
                ))}
              {!filtered.some((t) => t.status === status) && (
                <p className="quiet-empty">暂无任务</p>
              )}
            </section>
          ))}
        </div>
      )}
      {view === "calendar" && (
        <section className="surface task-calendar">
          <div className="task-toolbar">
            <Space>
              <Button
                aria-label="上个月"
                icon={<LeftOutlined />}
                onClick={() => shiftMonth(-1)}
              />
              <strong>
                {year} 年 {monthNumber} 月
              </strong>
              <Button
                aria-label="下个月"
                icon={<RightOutlined />}
                onClick={() => shiftMonth(1)}
              />
              <Button
                onClick={() => {
                  setMonth(today.slice(0, 7));
                  setSelectedDay(today);
                }}
              >
                今天
              </Button>
            </Space>
            <span>
              按截止日期排列 · 无截止时间{" "}
              {filtered.filter((t) => !t.due_date).length} 项
            </span>
          </div>
          <div className="task-calendar-grid">
            {["一", "二", "三", "四", "五", "六", "日"].map((d) => (
              <div className="task-calendar-week" key={d}>
                {d}
              </div>
            ))}
            {cells.map((c) => {
              const dayTasks = filtered.filter((t) => dueOn(t, c.key, today));
              return (
                <button
                  className={`task-calendar-day ${c.current ? "" : "outside"} ${c.key === today ? "today" : ""} ${selectedDay === c.key ? "selected" : ""}`}
                  key={c.key}
                  onClick={() => setSelectedDay(c.key)}
                  aria-label={`${c.key}，${dayTasks.length} 项任务`}
                >
                  <strong>{c.day}</strong>
                  {dayTasks.slice(0, 2).map((t) => (
                    <span key={t.id}>{t.title}</span>
                  ))}
                  {dayTasks.length > 2 && (
                    <small>另 {dayTasks.length - 2} 项</small>
                  )}
                </button>
              );
            })}
          </div>
          <p className="task-result-count">
            日任务只有时间，显示在今天；周任务按具体截止日期排列，不自动重复创建。
          </p>
          {selectedDay && (
            <div className="task-day-details">
              <h3>{selectedDay} 截止的任务</h3>
              {filtered
                .filter((t) => dueOn(t, selectedDay, today))
                .map((t) => (
                  <div key={t.id}>
                    <button
                      className="task-title-button"
                      onClick={() => show(t)}
                    >
                      {t.title}
                    </button>
                    {statusSelect(t)}
                  </div>
                ))}
              {!filtered.some((t) => dueOn(t, selectedDay, today)) && (
                <p>当天没有到期任务。</p>
              )}
            </div>
          )}
        </section>
      )}
      {view === "progress" && (
        <section className="surface task-progress-view">
          <h2>当前筛选的完成情况</h2>
          <Progress
            percent={
              filtered.length
                ? Math.round(
                    (filtered.filter((t) => t.status === "done").length /
                      filtered.length) *
                      100,
                  )
                : 0
            }
          />
          <div className="task-progress-status">
            {Object.entries(statuses).map(([s, label]) => (
              <span key={s}>
                {label}{" "}
                <strong>{filtered.filter((t) => t.status === s).length}</strong>
              </span>
            ))}
          </div>
          <h3>按项目跟进</h3>
          {[{ id: 0, name: "未关联项目" }, ...projects].map((p) => {
            const group = filtered.filter((t) => (t.project_id || 0) === p.id);
            return group.length ? (
              <div className="task-project-progress" key={p.id}>
                <div>
                  <strong>{p.name}</strong>
                  <span>
                    {group.filter((t) => t.status === "done").length} /{" "}
                    {group.length} 已完成 ·{" "}
                    {group.filter((t) => overdue(t, now)).length} 逾期
                  </span>
                </div>
                <Progress
                  percent={Math.round(
                    (group.filter((t) => t.status === "done").length /
                      group.length) *
                      100,
                  )}
                  size="small"
                />
              </div>
            ) : null;
          })}
          {!filtered.length && <Empty description="暂无可统计的任务" />}
        </section>
      )}
      <Drawer
        title={editing ? (writable ? "编辑任务" : "任务详情") : "新建任务"}
        open={open}
        onClose={() => {
          if (!busy) setOpen(false);
        }}
        size={560}
        destroyOnHidden
      >
        {editing && (
          <p className="task-detail-caption">
            #{editing.id} · 创建人：
            {editing.owner_name ||
              members.find((m) => m.id === editing.owner_id)?.name ||
              "系统"}
            {!writable ? " · 仅创建人或管理员可编辑任务信息" : ""}
          </p>
        )}
        {!writable && editing && (
          <div className="task-assignee-status">
            更新执行状态{" "}
            {statusSelect(items.find((t) => t.id === editing.id) || editing)}
          </div>
        )}
        <Form
          form={form}
          layout="vertical"
          onFinish={save}
          disabled={busy || !writable}
          onValuesChange={(v) => {
            if ("period" in v)
              form.setFieldsValue({ startDate: "", dueDate: "" });
          }}
        >
          <Form.Item
            name="title"
            label="任务标题"
            rules={[
              { required: true, whitespace: true, message: "请输入任务标题" },
              { max: 200, message: "标题不能超过 200 字" },
            ]}
          >
            <Input maxLength={200} placeholder="例如：完成首页设计评审" />
          </Form.Item>
          <Form.Item name="notes" label="任务说明">
            <Input.TextArea
              rows={4}
              maxLength={2000}
              showCount
              placeholder="写清目标、交付内容和注意事项"
            />
          </Form.Item>
          <div className="task-form-grid">
            <Form.Item name="projectId" label="所属项目">
              <Select
                allowClear
                placeholder="未关联项目"
                options={projects
                  .filter((p) => p.status !== "archived")
                  .map((p) => ({ label: p.name, value: p.id }))}
              />
            </Form.Item>
            <Form.Item name="assigneeId" label="负责人">
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
                placeholder="未分配"
                options={members
                  .filter(
                    (m) =>
                      visibility !== "personal" ||
                      m.id === (editing?.owner_id ?? actor.id),
                  )
                  .map((m) => ({ label: m.name, value: m.id }))}
              />
            </Form.Item>
            <Form.Item name="status" label="状态">
              <Select options={option(statuses)} />
            </Form.Item>
            <Form.Item name="priority" label="优先级">
              <Select options={option(priorities)} />
            </Form.Item>
            <Form.Item name="visibility" label="可见范围">
              <Select
                options={[
                  { label: "仅自己", value: "personal" },
                  { label: "团队可见", value: "public" },
                ]}
              />
            </Form.Item>
            <Form.Item name="period" label="计划类型">
              <Select
                options={[
                  { label: "单次任务", value: "" },
                  { label: "日任务（时间）", value: "daily" },
                  { label: "周任务（日期）", value: "weekly" },
                ]}
              />
            </Form.Item>
            <Form.Item name="startDate" label="开始时间">
              <Input type={period === "daily" ? "time" : "date"} />
            </Form.Item>
            <Form.Item name="dueDate" label="截止时间">
              <Input type={period === "daily" ? "time" : "date"} />
            </Form.Item>
          </div>
          <p className="task-result-count">
            负责人可更新团队任务的状态；任务信息与删除由创建人或管理员维护。计划类型仅作安排，不自动重复创建。
          </p>
          {writable && (
            <div className="task-form-actions">
              <Button onClick={() => setOpen(false)} disabled={busy}>
                取消
              </Button>
              <Button type="primary" htmlType="submit" loading={busy}>
                保存任务
              </Button>
            </div>
          )}
        </Form>
      </Drawer>
    </div>
  );
}
