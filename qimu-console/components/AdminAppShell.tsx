"use client";

import {
  Avatar,
  Breadcrumb,
  Button,
  Dropdown,
  Layout,
  Menu,
  Tag,
  Tooltip,
} from "antd";
import {
  FullscreenExitOutlined,
  FullscreenOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  HOME_MENU,
  PATH_GROUP_KEYS,
  PATH_GROUPS,
  PATH_TITLES,
  SIDEBAR_MENU,
} from "./modules";

const { Sider, Header, Content } = Layout;

export type AdminUser = {
  username: string;
  displayName: string | null;
  role: "admin" | "member";
};

type TabItem = { path: string; title: string };

export default function AdminAppShell({
  user,
  children,
}: {
  user: AdminUser;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [compact, setCompact] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [openKeys, setOpenKeys] = useState<string[]>(() => {
    const g = PATH_GROUP_KEYS[pathname];
    return g ? [g] : [];
  });
  // 多标签页：初始含「首页」，随路由追加
  const [tabs, setTabs] = useState<TabItem[]>([
    { path: HOME_MENU.key, title: HOME_MENU.label },
  ]);

  useEffect(() => {
    const title = PATH_TITLES[pathname];
    if (!title) return;
    setTabs((prev) =>
      prev.some((t) => t.path === pathname)
        ? prev
        : [...prev, { path: pathname, title }],
    );
  }, [pathname]);

  useEffect(() => {
    const onFsChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  }

  function closeTab(path: string) {
    setTabs((prev) => {
      const next = prev.filter((t) => t.path !== path);
      if (next.length === 0)
        next.push({ path: HOME_MENU.key, title: HOME_MENU.label });
      if (pathname === path) {
        const last = next[next.length - 1];
        router.push(last.path);
      }
      return next;
    });
  }

  async function logout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      /* 忽略登出失败 */
    }
    document.cookie = "token=; path=/; max-age=0";
    router.replace("/login");
    router.refresh();
  }

  const menuItems = [
    { key: HOME_MENU.key, icon: HOME_MENU.icon, label: HOME_MENU.label },
    ...SIDEBAR_MENU.map((g) => ({
      key: g.key,
      icon: g.icon,
      label: g.label,
      children: g.children.map((c) => ({
        key: c.key,
        icon: c.icon,
        label: c.label,
      })),
    })),
  ];

  const selectedKeys = [pathname];
  const pageTitle = PATH_TITLES[pathname] ?? "";
  const pageGroup = PATH_GROUPS[pathname];

  const initial = (user.displayName || user.username).slice(0, 1).toUpperCase();

  return (
    <Layout className="platform-shell">
      {/* ============ 侧边栏 ============ */}
      <Sider
        theme="light"
        width={216}
        collapsedWidth={0}
        breakpoint="lg"
        onBreakpoint={(broken) => { setCollapsed(broken); setCompact(broken); }}
        collapsed={collapsed}
        className="admin-sidebar"
      >
        {/* Logo 区 — 与 qimu-desk 共用 Qimu 品牌主标识 */}
        <div
          style={{
            height: 76,
            display: "flex",
            alignItems: "center",
            justifyContent: collapsed ? "center" : "flex-start",
            gap: 10,
            padding: collapsed ? 0 : "0 16px",
            background: "#f8fafb",
            overflow: "hidden",
            flexShrink: 0,
          }}
        >
          <img className="brand-logo" src="/logo-brand.png" alt="栖木管理台" width={32} height={32} />
          {!collapsed && (
            <span
              style={{
                color: "#263445",
                fontWeight: 600,
                fontSize: 14,
                whiteSpace: "nowrap",
              }}
            >
              栖木管理台
            </span>
          )}
        </div>

        {/* 分组菜单 */}
        <Menu
          theme="light"
          mode="inline"
          items={menuItems}
          selectedKeys={selectedKeys}
          openKeys={collapsed ? [] : openKeys}
          onOpenChange={(keys) => setOpenKeys(keys as string[])}
          onClick={({ key }) => { router.push(key); if (compact) setCollapsed(true); }}
          style={{ borderInlineEnd: "none", paddingTop: 4, background: "transparent" }}
        />
      </Sider>

      <Layout className="main-layout">
        {/* ============ 顶栏 ============ */}
        <Header
          className="platform-header"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            paddingInline: 16,
            borderBottom: "1px solid #e8e8e8",
            position: "sticky",
            top: 0,
            zIndex: 20,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              minWidth: 0,
            }}
          >
            <Button
              type="text"
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setCollapsed((c) => !c)}
              aria-label={collapsed ? "展开导航" : "收起导航"}
              style={{ fontSize: 16 }}
            />
            <Breadcrumb
              items={[
                { title: "首页", href: "/" },
                ...(pageGroup ? [{ title: pageGroup }] : []),
                ...(pageTitle && pathname !== "/"
                  ? [{ title: pageTitle }]
                  : []),
              ]}
            />
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Tooltip title={fullscreen ? "退出全屏" : "全屏"}>
              <Button
                type="text"
                icon={
                  fullscreen ? (
                    <FullscreenExitOutlined />
                  ) : (
                    <FullscreenOutlined />
                  )
                }
                onClick={toggleFullscreen}
              />
            </Tooltip>
            <Dropdown
              menu={{
                items: [
                  {
                    key: "logout",
                    icon: <LogoutOutlined />,
                    label: "退出登录",
                    onClick: logout,
                  },
                ],
              }}
              placement="bottomRight"
            >
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  cursor: "pointer",
                  padding: "4px 8px",
                }}
              >
                <Avatar
                  size={28}
                  style={{ background: "#345d88" }}
                  icon={<UserOutlined />}
                >
                  {initial}
                </Avatar>
                <span style={{ fontSize: 13, color: "rgba(0,0,0,.88)" }}>
                  {user.displayName || user.username}
                </span>
              </span>
            </Dropdown>
          </div>
        </Header>

        {/* ============ 多标签页 TagsView ============ */}
        <div
          className="workspace-tabs"
          style={{
            background: "#fff",
            borderBottom: "1px solid #e8e8e8",
            padding: "5px 12px",
            display: "flex",
            alignItems: "center",
            gap: 6,
            overflowX: "auto",
            position: "sticky",
            top: 60,
            zIndex: 19,
            minHeight: 34,
          }}
        >
          {tabs.map((t) => {
            const active = t.path === pathname;
            return (
              <Tag
                key={t.path}
                closable={t.path !== "/"}
                onClose={(e) => {
                  e.preventDefault();
                  closeTab(t.path);
                }}
                onClick={() => router.push(t.path)}
                style={{
                  marginInlineEnd: 0,
                  cursor: "pointer",
                  borderRadius: 3,
                  paddingInline: 8,
                  lineHeight: "22px",
                  userSelect: "none",
                  ...(active
                    ? {
                        color: "#fff",
                        background: "#345d88",
                        border: "1px solid #345d88",
                      }
                    : {
                        background: "#fff",
                        border: "1px solid #d9d9d9",
                        color: "rgba(0,0,0,.65)",
                      }),
                }}
              >
                {t.title}
              </Tag>
            );
          })}
          {tabs.length > 1 && (
            <span
              onClick={() => {
                const home = tabs.find((t) => t.path === "/");
                setTabs(home ? [home] : [{ path: "/", title: "首页" }]);
                router.push("/");
              }}
              style={{
                marginLeft: "auto",
                fontSize: 12,
                color: "#8c8c8c",
                cursor: "pointer",
                whiteSpace: "nowrap",
                paddingInline: 6,
              }}
            >
              关闭全部
            </span>
          )}
        </div>

        {/* ============ 内容区 ============ */}
        <Content
          className="platform-content"
          style={{ padding: 24, minHeight: "calc(100dvh - 94px)" }}
        >
          {children}
        </Content>
      </Layout>
    </Layout>
  );
}
