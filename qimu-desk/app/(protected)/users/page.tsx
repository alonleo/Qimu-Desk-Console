import { redirect } from "next/navigation";
import { currentUser } from "@/core/auth";
import UsersManager from "@/components/users/UsersManager";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const user = await currentUser();
  if (!user) {
    redirect("/login");
  }

  // 非管理员无法访问用户管理页面
  if (user.role !== "admin") {
    return (
      <div style={{ padding: 40, textAlign: "center" }}>
        <h2>无权限访问</h2>
        <p>用户管理功能仅管理员可用。</p>
      </div>
    );
  }

  // 从后端获取用户列表
  const BACKEND = process.env.ADMIN_BACKEND_URL || "http://localhost:8080";
  let users: unknown[] = [];
  try {
    const res = await fetch(`${BACKEND}/api/admin/users`, {
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
    });
    if (res.ok) {
      users = (await res.json()) as unknown[];
    }
  } catch (e) {
    console.error("获取用户列表失败:", e);
  }

  return <UsersManager users={users as Parameters<typeof UsersManager>[0]["users"]} />;
}
