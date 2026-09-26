"use client";

import Link from "next/link";
import { Badge } from "antd";
import { usePathname } from "next/navigation";
import { DESK_GROUPS, MODULE_META, type ModuleKey } from "./modules";

export default function SidebarNav({ isAdmin, chatUnread = 0, onNavigate }: {
  isAdmin: boolean; chatUnread?: number; onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const selected = pathname === "/preview" ? "/" : pathname;
  const entry = (key: ModuleKey) => {
    const m = MODULE_META[key];
    const active = selected === m.href || (m.href !== "/" && selected.startsWith(m.href + "/"));
    return (
      <Link className={`workspace-nav-link${active ? " is-active" : ""}`} key={key}
        href={m.href} aria-current={active ? "page" : undefined} onClick={onNavigate}>
        {m.icon}<span>{m.label}</span>
        {key === "chat" && chatUnread > 0 && <Badge count={chatUnread} size="small" overflowCount={99} />}
      </Link>
    );
  };
  return (
    <nav className="workspace-nav" aria-label="工作台模块">
      {entry("dashboard")}
      {DESK_GROUPS.map(group => {
        const keys = group.modules.filter(key => !MODULE_META[key].adminOnly || isAdmin);
        return keys.length > 0 && <section className="workspace-nav-group" key={group.key} aria-label={group.label}>
          <h2>{group.label}</h2>{keys.map(entry)}
        </section>;
      })}
    </nav>
  );
}
