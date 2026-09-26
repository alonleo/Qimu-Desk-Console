import JobLogsManager, { type SysJobLogRow } from "@/components/monitor/JobLogsManager";
import { serverApi } from "@/utils/serverApi";

export const dynamic = "force-dynamic";

type JobLogsResp = { ok: boolean; total: number; page: number; pageSize: number; items: SysJobLogRow[] };

export default async function MonitorJobLogPage() {
  const data = await serverApi<JobLogsResp>("/monitor/jobLog/list?page=1&pageSize=20");
  return (
    <JobLogsManager
      initialLogs={data.items}
      initialTotal={data.total}
      initialPage={data.page}
      initialPageSize={data.pageSize}
    />
  );
}
