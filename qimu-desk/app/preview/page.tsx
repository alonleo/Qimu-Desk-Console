import { cookies, headers } from "next/headers";
import { redirect, notFound } from "next/navigation";
import {
  PREVIEW_COOKIE,
  previewEnabled,
  localRequest,
  validPreviewSession,
} from "@/core/local-preview";
import View from "@/components/DashboardView";
import PreviewExit from "@/components/PreviewExit";
export const dynamic = "force-dynamic";
export default async function PreviewPage() {
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
        仅预览首页布局，业务入口暂不可用。连接认证后端和数据库后可使用完整功能。
      </div>
      <div className="preview-content">
        <div className="preview-readonly" inert>
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
        </div>
      </div>
    </main>
  );
}
