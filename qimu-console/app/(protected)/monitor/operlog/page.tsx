import OperLogsManager, { type SysOperLogRow } from "@/components/monitor/OperLogsManager";
import { serverApi } from "@/utils/serverApi";

export const dynamic = "force-dynamic";

type OperLogsResp = { ok: boolean; total: number; page: number; pageSize: number; items: SysOperLogRow[] };

export default async function MonitorOperLogPage() {
  const data = await serverApi<OperLogsResp>("/monitor/operlog/list?page=1&pageSize=20");
  return (
    <OperLogsManager
      initialLogs={data.items}
      initialTotal={data.total}
      initialPage={data.page}
      initialPageSize={data.pageSize}
    />
  );
}
