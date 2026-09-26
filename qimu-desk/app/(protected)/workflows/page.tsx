import { currentUser } from "@/core/auth";
import { listWorkflows, listWorkflowRuns } from "@/core/workflows";
import WorkflowsView from "@/components/workflows/WorkflowsView";

export const dynamic = "force-dynamic";

export default async function WorkflowsPage() {
  const user = await currentUser();
  const [workflows, recentRuns] = await Promise.all([
    listWorkflows(user),
    listWorkflowRuns(undefined, 100, user),
  ]);
  return <WorkflowsView initialWorkflows={workflows} initialRuns={recentRuns.map(r => ({ ...r, triggered_by: r.triggered_by ?? null }))} />;
}
