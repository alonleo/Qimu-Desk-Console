import { redirect } from "next/navigation";
import { currentUser } from "@/core/auth";
import { adminUrl } from "@/core/admin-url";

export const dynamic = "force-dynamic";

/** Legacy Desk bookmark: administration now lives in Console. */
export default async function LegacyAdminPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/");
  redirect(adminUrl() + "/users");
}
