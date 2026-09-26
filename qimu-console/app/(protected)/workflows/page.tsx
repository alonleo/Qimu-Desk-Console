import { serverApi } from "@/utils/serverApi";
import WorkflowsManager, { type WorkflowItem, type RunSummary } from "@/components/workflows/WorkflowsManager";

export const dynamic = "force-dynamic";

export default async function WorkflowsPage() {
  const { workflows } = await serverApi<{ workflows: WorkflowItem[] }>("/workflows");
  const { runs } = await serverApi<{ runs: RunSummary[] }>("/workflow-runs?limit=20");
  return <WorkflowsManager workflows={workflows} runs={runs} />;
}
