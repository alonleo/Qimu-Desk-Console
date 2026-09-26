import { redirect } from "next/navigation";
import { currentUser } from "@/core/auth";
import AppShell from "@/components/AppShell";

export const dynamic = "force-dynamic";

/** 统一后不再有 /setup：用户全部由后台管理平台开户，此处只校验登录态 */
export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/login");

  return (
    <AppShell user={{ username: user.username, displayName: user.displayName ?? null, role: user.role }}>
      {children}
    </AppShell>
  );
}
