import CacheManager, { type CacheInfo, type CacheNamesResp } from "@/components/monitor/CacheManager";
import { serverApi } from "@/utils/serverApi";

export const dynamic = "force-dynamic";

export default async function MonitorCachePage() {
  let initialInfo: CacheInfo = { ok: true, info: {}, dbSize: 0, commandStats: [] };
  let initialNames: string[] = [];
  let initialError: string | null = null;

  try {
    const info = await serverApi<CacheInfo>("/monitor/cache");
    if (info.ok === false) initialError = info.error ?? "缓存监控不可用";
    else initialInfo = info;
  } catch {
    initialError = "后端不可用，缓存监控加载失败";
  }

  try {
    const names = await serverApi<CacheNamesResp>("/monitor/cache/getNames");
    if (names.ok === false) {
      if (!initialError) initialError = names.error ?? "获取缓存名称失败";
    } else {
      initialNames = names.items ?? [];
    }
  } catch {
    if (!initialError) initialError = "后端不可用，缓存名称加载失败";
  }

  return <CacheManager initialInfo={initialInfo} initialNames={initialNames} initialError={initialError} />;
}