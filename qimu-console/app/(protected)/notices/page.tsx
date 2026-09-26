import NoticesManager, { type NoticeRow } from "@/components/NoticesManager";
import { serverApi } from "@/utils/serverApi";

export const dynamic = "force-dynamic";

type NoticesPageData = {
  ok: boolean;
  total: number;
  page: number;
  pageSize: number;
  notices: NoticeRow[];
};

export default async function NoticesPage() {
  const data = await serverApi<NoticesPageData>("/notices?page=1&pageSize=10");
  return (
    <NoticesManager
      initialNotices={data.notices}
      initialTotal={data.total}
      initialPage={data.page}
      initialPageSize={data.pageSize}
    />
  );
}
