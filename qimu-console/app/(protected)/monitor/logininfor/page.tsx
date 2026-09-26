import LogininforManager, { type SysLogininforRow } from "@/components/monitor/LogininforManager";
import { serverApi } from "@/utils/serverApi";

export const dynamic = "force-dynamic";

type LogininforResp = { ok: boolean; total: number; page: number; pageSize: number; items: SysLogininforRow[] };

export default async function MonitorLogininforPage() {
  const data = await serverApi<LogininforResp>("/monitor/logininfor/list?page=1&pageSize=20");
  return (
    <LogininforManager
      initialLogs={data.items}
      initialTotal={data.total}
      initialPage={data.page}
      initialPageSize={data.pageSize}
    />
  );
}
