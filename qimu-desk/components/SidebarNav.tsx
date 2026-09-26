"use client";

import { Badge } from "antd";
import { usePathname, useRouter } from "next/navigation";
import { MODULE_META } from "./modules";
import { T } from "./theme";

export default function SidebarNav({
  isAdmin,
  chatUnread = 0,
  onNavigate,
}: {
  isAdmin: boolean;
  chatUnread?: number;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();

  // 通知公告 / 个人资料 均不在侧边栏展示（与通知同逻辑：入口在 Header，而非独立模块）
  // - 通知公告：Header 铃铛 NoticeCenter「查看全部」
  // - 个人资料：Header 头像旁的「个人资料」按钮 → /profile
  const entries = Object.entries(MODULE_META)
    .filter(([key]) => key !== "notices" && key !== "profile")
    .filter(([, m]) => !m.adminOnly || isAdmin);

  const hrefs = Object.values(MODULE_META).map((m) => m.href);
  const selected =
    pathname === "/"
      ? "/"
      : (hrefs
          .filter((h) => h !== "/" && pathname.startsWith(h))
          .sort((a, b) => b.length - a.length)
          .slice(0, 1)[0] ?? "");

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 2,
        padding: "4px 12px",
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: T.ink3,
          letterSpacing: "0.05em",
          padding: "10px 12px 6px",
        }}
      >
        工作空间
      </div>

      {entries.map(([key, m]) => {
        const active = selected === m.href;
        return (
          <button
            key={key}
            type="button"
            aria-current={active ? "page" : undefined}
            onClick={() => {
              router.push(m.href);
              onNavigate?.();
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              width: "100%",
              height: 40,
              padding: "0 12px",
              border: "none",
              borderRadius: 5,
              cursor: "pointer",
              textAlign: "left",
              background: active ? T.primaryBg : "transparent",
              color: active ? T.primaryDeep : T.ink2,
              fontWeight: active ? 600 : 500,
              fontSize: 14,
              transition: "background .15s, color .15s",
            }}
            onMouseEnter={(e) => {
              if (!active) e.currentTarget.style.background = T.bgSoft;
            }}
            onMouseLeave={(e) => {
              if (!active) e.currentTarget.style.background = "transparent";
            }}
          >
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                fontSize: 16,
                color: active ? T.primaryDeep : T.inkMid,
              }}
            >
              {m.icon}
            </span>
            {key === "chat" && chatUnread > 0 ? (
              <Badge
                count={chatUnread > 99 ? "99+" : chatUnread}
                size="small"
                color="#ff4d4f"
                offset={[6, -2]}
              >
                {m.label}
              </Badge>
            ) : (
              m.label
            )}
          </button>
        );
      })}
    </div>
  );
}
