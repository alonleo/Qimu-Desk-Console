import { rows } from "@/core/db";
import { currentUser } from "@/core/auth";
import { listWorkflows } from "@/core/workflows";
import WorkflowsView, { type RunSummary } from "@/components/workflows/WorkflowsView";

export const dynamic = "force-dynamic";

export default async function WorkflowsPage() {
  // listWorkflows 内部会先播种 workflows/ 目录，页面永远展示最新注册结果
  // 页面级最近运行只要摘要，不带逐步日志（日志在抽屉里按需展示）
  const user = await currentUser();
  const [workflows, recentRuns] = await Promise.all([
    listWorkflows(user),
    rows<RunSummary>(`
      SELECT r.id, w.name AS workflow_name, r.status, r.duration_ms, r.triggered_by, r.started_at
      FROM runs r JOIN workflows w ON w.id = r.workflow_id
      ORDER BY r.id DESC LIMIT 10
    `),
  ]);

  return <WorkflowsView initialWorkflows={workflows} initialRuns={recentRuns} />;
}
