import Link from "next/link";
import TaskDemo from "@/components/tasks/TaskDemo";
import { cookies, headers } from "next/headers";
import { redirect, notFound } from "next/navigation";
import {
  PREVIEW_COOKIE,
  previewEnabled,
  localRequest,
  validPreviewSession,
} from "@/core/local-preview";
import View from "@/components/DashboardView";
import PreviewNavigation from "@/components/SidebarNav";
import PreviewExit from "@/components/PreviewExit";
export const dynamic = "force-dynamic";
export default async function PreviewPage({searchParams}:{searchParams:Promise<{view?:string}>}) {
  const taskPreview = (await searchParams).view === "tasks";
  if (!previewEnabled() || !localRequest(await headers())) notFound();
  if (!validPreviewSession((await cookies()).get(PREVIEW_COOKIE)?.value))
    redirect("/login");
  return (
    <main className="local-preview">
      <header className="preview-bar">
        <strong className="preview-brand"><img className="brand-logo" src="/logo-brand.png" alt="" width={32} height={32} />栖木工作台 · 本地预览</strong>
        <PreviewExit />
      </header>
      <div className="preview-notice" role="status">
        本地演示数据 ·
        首页为只读布局，任务演示可交互；均不连接真实业务数据。
      </div>
      <nav className="preview-view-tabs" aria-label="预览内容"><Link href="/preview">首页布局</Link><Link href="/preview?view=tasks">任务模块演示</Link></nav>
      <div className="preview-workspace">
        <aside className="preview-sidebar" inert aria-label="模块导航预览">
          <div className="preview-sidebar-label">模块导航</div>
          <PreviewNavigation isAdmin />
        </aside>
      <div className="preview-content">
        {taskPreview ? <TaskDemo mode="desk"/> : <div className="preview-readonly" inert>
          <View
            userName="预览用户"
            stats={{
              tasks: 18,
              skills: 6,
              workflows: 4,
              docs: 24,
              aiEnabled: false,
            }}
            taskSummary={{ todo: 5, doing: 3, waiting: 2, done: 8 }}
            recentTasks={[
              {
                id: 1,
                title: "示例：整理本周项目进度",
                status: "doing",
                priority: "high",
                project_name: "示例项目",
                project_color: null,
              },
              {
                id: 2,
                title: "示例：准备设计评审",
                status: "todo",
                priority: "normal",
                project_name: "界面改版",
                project_color: null,
              },
            ]}
            projectProgress={[
              {
                id: 1,
                name: "示例：工作台改版",
                color: null,
                total: 12,
                done: 7,
              },
            ]}
            recentNotices={[]}
          />
        </div>}
      </div>
      </div>
    </main>
  );
}
