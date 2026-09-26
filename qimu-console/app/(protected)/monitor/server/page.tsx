import ServerMonitor from "@/components/monitor/ServerMonitor";
import { serverApi } from "@/utils/serverApi";

export const dynamic = "force-dynamic";

type ServerResp = {
  ok: boolean;
  cpu: { cpuNum: number; total: number; used: number; sys: number; free: number };
  mem: { total: number; used: number; free: number; usage: number };
  jvm: {
    total: number; max: number; used: number; free: number; usage: number;
    name: string; version: string; vendor: string;
    startTime: number; runTime: number; home: string; inputArgs: string;
    nonheapTotal: number; nonheapUsed: number; nonheapMax: number;
  };
  sys: { computerName: string; computerIp: string; userName: string; osName: string; osArch: string; osVersion: string; userDir: string; userHome: string };
  sysFiles: { dirName: string; sysTypeName: string; typeName: string; total: number; free: number; used: number; usage: number }[];
};

export default async function MonitorServerPage() {
  // 首屏快照；客户端会接管 5s 轮询
  let initial: ServerResp | null = null;
  try {
    initial = await serverApi<ServerResp>("/monitor/server");
  } catch {
    initial = null;
  }
  return <ServerMonitor initial={initial as any} />;
}
