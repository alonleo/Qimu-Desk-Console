import OnlineManager, { type OnlineRow } from "@/components/monitor/OnlineManager";
import { serverApi } from "@/utils/serverApi";

export const dynamic = "force-dynamic";

type OnlineResp = { ok: boolean; total: number; page: number; pageSize: number; items: OnlineRow[] };

export default async function MonitorOnlinePage() {
  const data = await serverApi<OnlineResp>("/monitor/online/list?page=1&pageSize=10");
  return (
    <OnlineManager
      initialRows={data.items}
      initialTotal={data.total}
      initialPage={data.page}
      initialPageSize={data.pageSize}
    />
  );
}