import JobsManager, { type SysJobRow } from "@/components/monitor/JobsManager";
import { serverApi } from "@/utils/serverApi";

export const dynamic = "force-dynamic";

type JobsResp = { ok: boolean; total: number; page: number; pageSize: number; items: SysJobRow[] };

export default async function MonitorJobPage() {
  const data = await serverApi<JobsResp>("/monitor/job/list?page=1&pageSize=20");
  return (
    <JobsManager
      initialJobs={data.items}
      initialTotal={data.total}
      initialPage={data.page}
      initialPageSize={data.pageSize}
    />
  );
}
