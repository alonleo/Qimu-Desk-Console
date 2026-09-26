"use client";
import Link from "next/link";

import { useRouter } from "next/navigation";
import { Button, Progress, Table, Tag } from "antd";
import {
  ArrowRightOutlined,
  NotificationOutlined,
  ReadOutlined,
  TeamOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";

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
          <p>查看任务进度与最近执行记录。</p>
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
      <section className="surface">
        <div className="surface-heading">
          <h2>常用管理</h2>
          <span className="section-hint">成员与内容</span>
        </div>
        <div className="admin-shortcuts">
          {[
            {
              label: "用户管理",
              desc: "账号与成员权限",
              href: "/users",
              icon: <TeamOutlined />,
            },
            {
              label: "知识库",
              desc: "文档与分类",
              href: "/knowledge",
              icon: <ReadOutlined />,
            },
            {
              label: "通知公告",
              desc: "团队通知与发布记录",
              href: "/notices",
              icon: <NotificationOutlined />,
            },
            {
              label: "技能管理",
              desc: "技能配置与维护",
              href: "/skills",
              icon: <ThunderboltOutlined />,
            },
          ].map((e) => (
            <Link href={e.href} key={e.href}>
              {e.icon}
              <span>
                <strong>{e.label}</strong>
                <small>{e.desc}</small>
              </span>
              <ArrowRightOutlined />
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
