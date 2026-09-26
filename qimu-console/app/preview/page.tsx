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
export default async function PreviewPage() {
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
        仅预览导航与首页布局，业务入口暂不可用。连接认证后端和数据库后可使用完整功能。
      </div>
      <div className="preview-workspace">
        <aside className="preview-sidebar" inert aria-label="模块导航预览">
          <div className="preview-sidebar-label">模块导航</div>
          <PreviewNavigation  />
        </aside>
      <div className="preview-content">
        <div className="preview-readonly" inert>
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
        </div>
      </div>
      </div>
    </main>
  );
}
