"use client";
import Link from "next/link";

import { useRouter } from "next/navigation";
import { Button, Progress, Table, Tag } from "antd";
import { ArrowRightOutlined } from "@ant-design/icons";
import { SIDEBAR_MENU } from "./modules";

type AdminStats = {
  users: number;
  tasks: number;
  skills: number;
  workflows: number;
  docs: number;
  categories: number;
  aiEnabled: boolean;
  taskSummary: { todo: number; doing: number; waiting: number; done: number };
  recentRuns: {
    id: number;
    name: string;
    status: string;
    triggered_by: string | null;
    started_at: string | null;
  }[];
};

type TaskStatusKey = "todo" | "doing" | "waiting" | "done";
const STATUS_META: Record<TaskStatusKey, { color: string; label: string }> = {
  todo: { color: "#345d88", label: "待办" },
  doing: { color: "#fa8c16", label: "进行中" },
  waiting: { color: "#8793a1", label: "等待" },
  done: { color: "#40846b", label: "已完成" },
};

export default function AdminDashboard({ stats }: { stats: AdminStats }) {
  const router = useRouter();
  const cards = [
    { module: "users", count: stats.users, label: "用户总数", href: "/users" },
    { module: "tasks", count: stats.tasks, label: "任务总数", href: "/tasks" },
    {
      module: "skills",
      count: stats.skills,
      label: "技能总数",
      href: "/skills",
    },
    {
      module: "workflows",
      count: stats.workflows,
      label: "工作流总数",
      href: "/workflows",
    },
    {
      module: "docs",
      count: stats.docs,
      label: "知识文档数",
      href: "/knowledge",
    },
    {
      module: "categories",
      count: stats.categories,
      label: "知识分类数",
      href: "/knowledge",
    },
  ] as const;

  const donePct =
    stats.tasks > 0
      ? Math.round((stats.taskSummary.done / stats.tasks) * 100)
      : 0;

  const runColumns = [
    { title: "流程名称", dataIndex: "name", key: "name", ellipsis: true },
    {
      title: "执行状态",
      dataIndex: "status",
      key: "status",
      width: 96,
      render: (s: string) => (
        <Tag
          color={
            s === "success"
              ? "success"
              : s === "failed"
                ? "error"
                : "processing"
          }
          style={{ marginInlineEnd: 0 }}
        >
          {s === "success" ? "成功" : s === "failed" ? "失败" : s}
        </Tag>
      ),
    },
    {
      title: "触发方式",
      dataIndex: "triggered_by",
      key: "triggered_by",
      width: 96,
      render: (v: string | null) => v ?? "手动",
    },
    {
      title: "开始时间",
      dataIndex: "started_at",
      key: "started_at",
      width: 150,
      render: (v: string | null) => (
        <span style={{ color: "#8c8c8c", fontSize: 12 }}>
          {v ? v.replace("T", " ").slice(0, 16) : "-"}
        </span>
      ),
    },
  ];

  return (
    <div className="overview">
      <header className="overview-heading">
        <div>
          <span className="section-label">QIMU / CONSOLE</span>
          <h1>管理概览</h1>
          <p>管理业务与成员，配置自动化，检查运行记录。</p>
        </div>
        <Button onClick={() => router.push("/ai")}>
          <span
            className={
              stats.aiEnabled ? "connection-dot connected" : "connection-dot"
            }
          />
          {stats.aiEnabled ? "AI 网关已启用" : "配置 AI 网关"}
          <ArrowRightOutlined />
        </Button>
      </header>
      <div className="metric-strip admin-metrics">
        {cards.map((c) => (
          <button
            className="metric-item"
            key={c.module}
            onClick={() => router.push(c.href)}
          >
            <span>
              {c.label
                .replace("总数", "")
                .replace("文档数", "文档")
                .replace("分类数", "分类")}
            </span>
            <strong>{c.count}</strong>
            <ArrowRightOutlined />
          </button>
        ))}
      </div>
      <section className="module-section" aria-labelledby="console-modules-title">
        <div className="module-section-heading"><h2 id="console-modules-title">管理模块</h2><span>配置与维护</span></div>
        <div className="module-directory console-directory">
          {SIDEBAR_MENU.map(group => <section className="module-group-card" key={group.key}>
            <h3>{group.icon}{group.label}</h3>
            <div className="module-link-list">
              {group.children.map(item => <Link href={item.key} key={item.key}>
                {item.icon}<span>{item.label}</span><ArrowRightOutlined />
              </Link>)}
            </div>
          </section>)}
        </div>
      </section>
      <div className="overview-columns admin-columns">
        <section className="surface">
          <div className="surface-heading">
            <h2>最近执行记录</h2>
            <Link href="/workflows">
              查看工作流 <ArrowRightOutlined />
            </Link>
          </div>
          <div className="run-table">
            <Table
              rowKey="id"
              size="middle"
              columns={runColumns}
              dataSource={stats.recentRuns}
              pagination={false}
              scroll={{ x: 540 }}
              locale={{ emptyText: "暂无执行记录，运行工作流后可在此查看。" }}
            />
          </div>
        </section>
        <aside className="overview-aside">
          <section className="surface">
            <div className="surface-heading">
              <h2>任务进度</h2>
              <Link href="/tasks">管理任务</Link>
            </div>
            <div className="task-progress">
              <div className="completion">
                <strong>
                  {donePct}
                  <small>%</small>
                </strong>
                <span>已完成</span>
              </div>
              <Progress
                percent={donePct}
                showInfo={false}
                strokeColor="#345d88"
              />
              {(Object.keys(STATUS_META) as TaskStatusKey[]).map((k) => (
                <div className="status-line" key={k}>
                  <span>
                    <i style={{ background: STATUS_META[k].color }} />
                    {STATUS_META[k].label}
                  </span>
                  <strong>{stats.taskSummary[k]}</strong>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>

    </div>
  );
}
