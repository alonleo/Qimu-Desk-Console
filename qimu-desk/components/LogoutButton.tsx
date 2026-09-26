"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "antd";
import { LogoutOutlined } from "@ant-design/icons";

export default function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function logout() {
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      /* 忽略网络错误，前端仍跳转登录页 */
    }
    router.replace("/login");
    router.refresh();
  }

  return (
    <Button type="text" size="small" icon={<LogoutOutlined />} onClick={logout} loading={busy}>
      退出
    </Button>
  );
}
