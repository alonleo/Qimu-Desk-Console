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
import View from "@/components/AdminDashboard";
import PreviewNavigation from "@/components/ConsoleNavigation";
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
        <strong className="preview-brand"><img className="brand-logo" src="/logo-brand.png" alt="" width={32} height={32} />栖木管理台 · 本地预览</strong>
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
          <PreviewNavigation  />
        </aside>
      <div className="preview-content">
        {taskPreview ? <TaskDemo mode="console"/> : <div className="preview-readonly" inert>
          <View
            stats={{
              users: 12,
              tasks: 18,
              skills: 6,
              workflows: 4,
              docs: 24,
              categories: 5,
              aiEnabled: false,
              taskSummary: { todo: 5, doing: 3, waiting: 2, done: 8 },
              recentRuns: [
                {
                  id: 1,
                  name: "示例：每日资料整理",
                  status: "success",
                  triggered_by: "定时",
                  started_at: "2026-09-27T09:00:00",
                },
              ],
            }}
          />
        </div>}
      </div>
      </div>
    </main>
  );
}
