import UsersManager, { type UserRow } from "@/components/UsersManager";
import { serverApi } from "@/utils/serverApi";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const users = await serverApi<UserRow[]>("/admin/users");
  return <UsersManager users={users} />;
}
