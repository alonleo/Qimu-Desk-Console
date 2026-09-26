"use client";
import Link from "next/link";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { App, Avatar, Input, Layout, Drawer, Button } from "antd";
import { SearchOutlined, MenuOutlined, UserOutlined } from "@ant-design/icons";
import SidebarNav from "./SidebarNav";
import LogoutButton from "./LogoutButton";
import NoticeCenter from "./notices/NoticeCenter";
import AIView from "./ai/AIView";
import { DESK_PATH_GROUPS, MODULE_META } from "./modules";
import { T } from "./theme";

const { Sider, Header, Content } = Layout;

export type ShellUser = {
  username: string;
  displayName: string | null;
  role: "admin" | "member";
};

export default function AppShell({
  user,
  children,
}: {
  user: ShellUser;
  children: React.ReactNode;
}) {
  const { message } = App.useApp();
  const [navOpen, setNavOpen] = useState(false);
  const [today, setToday] = useState("");
  // 聊天未读角标（chat-module）：30s 轮询本地轻量接口，简单可靠（架构文档 §1.4 定案）
  const [chatUnread, setChatUnread] = useState(0);
  // 全局搜索（对齐设计稿顶栏胶囊搜索框）：回车按模块名/路径模糊匹配跳转
  const [keyword, setKeyword] = useState("");

  // AI 助手常驻挂载：首次进入 /ai 后不再卸载，切走仅隐藏（display:none），
  // 保证流式回复与会话状态跨模块切换不中断（否则路由跳转会 unmount 导致对话"停止"）
  const pathname = usePathname();
  const isAI = pathname === "/ai";
  const [aiMounted, setAiMounted] = useState(false);
  useEffect(() => {
    if (isAI) setAiMounted(true);
  }, [isAI]);

  useEffect(() => {
    const d = new Date();
    setToday(`${d.getMonth() + 1}月${d.getDate()}日`);
  }, []);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/chat/unread", { cache: "no-store" });
        const body = (await res.json().catch(() => null)) as {
          ok?: boolean;
          data?: { total?: number };
        } | null;
        if (alive && res.ok && body?.ok === true) {
          setChatUnread(Math.max(0, Number(body.data?.total ?? 0)));
        }
      } catch {
        /* 轮询失败静默忽略，下一轮重试 */
      }
    };
    void load();
    const timer = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const router = useRouter();
  const initial = (user.displayName || user.username).slice(0, 1).toUpperCase();
  const displayName = user.displayName || user.username;
  const roleLabel = user.role === "admin" ? "管理员" : "成员";
  const onSearch = () => {
    const k = keyword.trim();
    if (!k) return;
    const hit = Object.values(MODULE_META).find(
      (m) =>
        (!m.adminOnly || user.role === "admin") &&
        (m.label.includes(k) || m.href.toLowerCase().includes(k.toLowerCase())),
    );
    if (hit) {
      router.push(hit.href);
      setKeyword("");
    } else {
      message.info(`未找到与「${k}」匹配的模块`);
    }
  };

  const nav = (
    <SidebarNav
      isAdmin={user.role === "admin"}
      chatUnread={chatUnread}
      onNavigate={() => setNavOpen(false)}
    />
  );
  const brand = (
    <Link href="/" className="brand">
      <img className="brand-logo" src="/logo-brand.png" alt="栖木工作台" width={32} height={32} />
      <span>
        栖木<span className="brand-caption">工作台</span>
      </span>
    </Link>
  );
  return (
    <Layout className="platform-shell">
      <Sider width={216} className="desktop-sidebar">
        {brand}
        <div className="sidebar-navigation">{nav}</div>
        <button
          className="sidebar-profile"
          onClick={() => router.push("/profile")}
        >
          <Avatar size={30} style={{ background: T.primary }}>
            {initial}
          </Avatar>
          <span>
            {displayName}
            <small>{roleLabel}</small>
          </span>
          <UserOutlined />
        </button>
      </Sider>
      <Drawer
        title="栖木工作台"
        placement="left"
        open={navOpen}
        onClose={() => setNavOpen(false)}
        size={260}
      >
        {nav}
      </Drawer>
      <Layout className="main-layout">
        <Header className="platform-header">
          <div className="header-location">
            <Button
              className="mobile-menu"
              type="text"
              aria-label="打开导航"
              icon={<MenuOutlined />}
              onClick={() => setNavOpen(true)}
            />
            <span>{DESK_PATH_GROUPS[pathname] || "工作空间"}</span>
            <span className="header-divider">/</span>
            <strong>
              {Object.values(MODULE_META).find((m) => m.href === pathname)
                ?.label || "工作台"}
            </strong>
          </div>
          <div className="header-actions">
            <Input
              className="module-search"
              prefix={<SearchOutlined />}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onPressEnter={onSearch}
              placeholder="查找功能"
              aria-label="查找功能"
            />
            <span className="header-date">{today}</span>
            <NoticeCenter />
            <LogoutButton />
          </div>
        </Header>
        <Content className="platform-content" style={{ padding: 24 }}>
          {(aiMounted || isAI) && (
            <div style={{ display: isAI ? "contents" : "none" }}>
              <AIView isAdmin={user.role === "admin"} />
            </div>
          )}
          {!isAI && children}
        </Content>
      </Layout>
    </Layout>
  );
}
