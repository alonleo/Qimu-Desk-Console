import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import AdminAppShell from "@/components/AdminAppShell";
import { Result, Button } from "antd";
import Link from "next/link";

export const dynamic = "force-dynamic";

const BACKEND = process.env.BACKEND_URL || "http://localhost:8080";

async function fetchMe(): Promise<{ username: string; displayName: string | null; role: "admin" | "member" } | null> {
  const token = (await cookies()).get("token")?.value;
  if (!token) return null;
  try {
    const res = await fetch(`${BACKEND}/api/auth/me`, {
      headers: { Cookie: `token=${token}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { user?: { username: string; displayName?: string | null; role?: string } };
    if (!data.user) return null;
    return {
      username: data.user.username,
      displayName: data.user.displayName ?? null,
      role: data.user.role === "admin" ? "admin" : "member",
    };
  } catch {
    return null;
  }
}

/** 后台管理平台仅管理员可进入；member 角色看到无权限提示 */
export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const user = await fetchMe();
  if (!user) {
    redirect("/login");
  }

  if (user.role !== "admin") {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#f0f2f5",
          padding: 24,
        }}
      >
        <Result
          status="403"
          title="无权限访问"
          subTitle="后台管理平台仅管理员可进入。请使用管理员账号登录，或联系管理员开通权限。"
          extra={
            <Link href="/login">
              <Button type="primary">切换账号</Button>
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <AdminAppShell user={user}>
      {children}
    </AdminAppShell>
  );
}
