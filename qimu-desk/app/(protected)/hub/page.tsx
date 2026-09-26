import HubPanel from "@/components/hub/HubPanel";

export const dynamic = "force-dynamic";

/** 管理联动：前台（工作台）执行 → 后台 MySQL 运行记录（后台 3001 只读展示） */
export default function HubPage() {
  return <HubPanel />;
}
