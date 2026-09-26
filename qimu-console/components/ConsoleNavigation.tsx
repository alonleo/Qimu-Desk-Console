"use client";
import { Menu } from "antd";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { HOME_MENU, PATH_GROUP_KEYS, SIDEBAR_MENU } from "./modules";

export default function ConsoleNavigation({ collapsed = false, onNavigate }: {
  collapsed?: boolean; onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const selected = pathname === "/preview" ? "/" : pathname;
  const [openKeys, setOpenKeys] = useState<string[]>([PATH_GROUP_KEYS[selected] || "grp-work"]);
  useEffect(() => {
    const group = PATH_GROUP_KEYS[pathname];
    if (group) setOpenKeys(prev => prev.includes(group) ? prev : [...prev, group]);
  }, [pathname]);
  return <nav aria-label="管理台模块" className="console-navigation">
    <Menu theme="light" mode="inline" selectedKeys={[selected]}
      openKeys={collapsed ? [] : openKeys} onOpenChange={setOpenKeys}
      onClick={({ key }) => { router.push(key); onNavigate?.(); }}
      items={[HOME_MENU, ...SIDEBAR_MENU]}
      style={{ borderInlineEnd: "none", background: "transparent" }} />
  </nav>;
}
