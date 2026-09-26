"use client";
import Link from "next/link";

import { useEffect, useState } from "react";
import { Button, Progress, Empty } from "antd";
import { useRouter } from "next/navigation";
import {
  ArrowRightOutlined,
  ClockCircleOutlined,
  SyncOutlined,
  PauseCircleOutlined,
  PushpinFilled,
} from "@ant-design/icons";
import { MODULE_META, type ModuleKey } from "./modules";
import { T } from "./theme";

type Stats = {
  tasks: number;
  skills: number;
  workflows: number;
  docs: number;
  aiEnabled: boolean;
  userCount?: number;
};

type TaskSummary = {
  todo: number;
  doing: number;
  waiting: number;
  done: number;
};

type RecentTask = {
  id: number;
  title: string;
  status: string;
  priority: string;
  project_name: string | null;
  project_color: string | null;
};

type ProjectProgress = {
  id: number;
  name: string;
  color: string | null;
  total: number;
  done: number;
};

type RecentNotice = {
  id: number;
  type: "notification" | "announcement";
  title: string;
  is_pinned: number;
  publisher_name: string | null;
  publish_time: string | null;
};

const STATUS_ICONS = {
  todo: { icon: <ClockCircleOutlined />, color: "#64748b", label: "待办" },
  doing: { icon: <SyncOutlined />, color: T.primary, label: "进行中" },
  waiting: { icon: <PauseCircleOutlined />, color: "#94a3b8", label: "等待" },
};

const PRIORITY_COLORS: Record<string, string> = {
  low: "#94a3b8",
  normal: "#64748b",
  high: T.orange,
  urgent: T.red,
};

const PRIORITY_LABELS: Record<string, string> = {
  low: "低",
  normal: "普通",
  high: "高",
  urgent: "紧急",
};

const NOTICE_TYPE_LABELS: Record<string, string> = {
  announcement: "公告",
  notification: "通知",
};
export default function DashboardView({
  userName,
  stats,
  taskSummary,
  recentTasks,
  projectProgress,
  recentNotices = [],
}: {
  userName: string;
  userRole?: string;
  stats: Stats;
  taskSummary: TaskSummary;
  recentTasks: RecentTask[];
  projectProgress: ProjectProgress[];
  recentNotices?: RecentNotice[];
}) {
  const router = useRouter();
  const [updatedAt, setUpdatedAt] = useState("");
  useEffect(() => {
    const d = new Date();
    setUpdatedAt(
      `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`,
    );
  }, []);

  // 资源数量与入口。
  const kpis: { module: ModuleKey; count: number }[] = [
    { module: "tasks", count: stats.tasks },
    { module: "skills", count: stats.skills },
    { module: "workflows", count: stats.workflows },
    { module: "knowledge", count: stats.docs },
  ];

  const openTotal = taskSummary.todo + taskSummary.doing + taskSummary.waiting;

  return (
    <div className="overview">
      <header className="overview-heading">
        <div>
          <span className="section-label">{userName} 的工作空间</span>
          <h1>工作概览</h1>
          <p>
            {openTotal > 0
              ? `还有 ${openTotal} 项任务待处理，先从当前的工作开始。`
              : "待办已清空，可以开始安排新的工作。"}
          </p>
        </div>
        <Button type="primary" onClick={() => router.push("/tasks")}>
          管理任务 <ArrowRightOutlined />
        </Button>
      </header>
      <div className="metric-strip">
        {kpis.map((c) => (
          <button
            key={c.module}
            className="metric-item"
            onClick={() => router.push(MODULE_META[c.module].href)}
          >
            <span>{MODULE_META[c.module].label}</span>
            <strong>{c.count}</strong>
            <ArrowRightOutlined />
          </button>
        ))}
      </div>
      <div className="overview-columns">
        <section className="surface task-surface">
          <div className="surface-heading">
            <h2>
              待处理任务 <span>{openTotal}</span>
            </h2>
            <Link href="/tasks">
              全部任务 <ArrowRightOutlined />
            </Link>
          </div>
          <div className="task-summary">
            <span>
              <i />
              待办 {taskSummary.todo}
            </span>
            <span>
              <i className="status-active" />
              进行中 {taskSummary.doing}
            </span>
            <span>
              <i className="status-waiting" />
              等待 {taskSummary.waiting}
            </span>
          </div>
          {recentTasks.length === 0 ? (
            <div className="calm-empty">
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="暂无待处理任务"
              />
              <Button onClick={() => router.push("/tasks")}>添加任务</Button>
            </div>
          ) : (
            <div className="task-list">
              {recentTasks.map((t) => {
                const status =
                  STATUS_ICONS[t.status as keyof typeof STATUS_ICONS] ||
                  STATUS_ICONS.todo;
                return (
                  <button
                    className="task-row"
                    key={t.id}
                    onClick={() => router.push("/tasks")}
                  >
                    <span
                      className="task-status"
                      style={{ color: status.color }}
                      aria-label={status.label}
                    >
                      {status.icon}
                    </span>
                    <span className="task-main">
                      <strong>{t.title}</strong>
                      <small>
                        {t.project_name || "未分配项目"} · {status.label}
                      </small>
                    </span>
                    <span
                      className="priority-label"
                      style={{ color: PRIORITY_COLORS[t.priority] }}
                    >
                      {PRIORITY_LABELS[t.priority] || t.priority}
                    </span>
                    <ArrowRightOutlined className="row-arrow" />
                  </button>
                );
              })}
            </div>
          )}
        </section>
        <aside className="overview-aside">
          <section className="surface">
            <div className="surface-heading">
              <h2>项目进度</h2>
              <Link href="/projects">查看项目</Link>
            </div>
            {projectProgress.length === 0 ? (
              <div className="calm-empty">
                <p>还没有项目</p>
                <Link href="/projects">创建第一个项目 →</Link>
              </div>
            ) : (
              <div className="project-list">
                {projectProgress.map((p) => (
                  <Link className="project-row" href="/projects" key={p.id}>
                    <div>
                      <strong>{p.name}</strong>
                      <span>
                        {p.done} / {p.total}
                      </span>
                    </div>
                    <Progress
                      percent={
                        p.total ? Math.round((p.done / p.total) * 100) : 0
                      }
                      showInfo={false}
                      strokeColor={T.primary}
                      size="small"
                    />
                  </Link>
                ))}
              </div>
            )}
          </section>
          <section className="surface">
            <div className="surface-heading">
              <h2>最新公告</h2>
              <Link href="/notices">全部</Link>
            </div>
            {recentNotices.length === 0 ? (
              <p className="quiet-empty">暂无新公告</p>
            ) : (
              <div className="notice-list">
                {recentNotices.map((n) => (
                  <Link href="/notices" key={n.id}>
                    <span>
                      {n.is_pinned === 1 && <PushpinFilled />} {n.title}
                    </span>
                    <small>
                      {n.publish_time?.slice(0, 10) ||
                        NOTICE_TYPE_LABELS[n.type]}
                    </small>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </aside>
      </div>
      <footer className="overview-footer">
        <span>工作台</span>
        {updatedAt && <span>数据更新于 {updatedAt}</span>}
      </footer>
    </div>
  );
}
