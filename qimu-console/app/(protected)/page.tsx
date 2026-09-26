import AdminDashboard from "@/components/AdminDashboard";
import { serverApi } from "@/utils/serverApi";

export const dynamic = "force-dynamic";

export default async function AdminDashboardPage() {
  const data = await serverApi<{ stats: unknown }>("/dashboard/stats");
  return <AdminDashboard stats={data.stats as never} />;
}
