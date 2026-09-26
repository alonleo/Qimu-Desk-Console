import type { ReactNode } from "react";
import {
  ApartmentOutlined,
  CheckSquareOutlined,
  DashboardOutlined,
  FolderOutlined,
  MessageOutlined,
  NotificationOutlined,
  ReadOutlined,
  RobotOutlined,
  ThunderboltOutlined,
  UserOutlined,
} from "@ant-design/icons";

/**
 * 模块名称、路径与图标。
 * 统一使用中性色，状态色只用于表达业务状态。
 */
export type ModuleKey =
  | "dashboard"
  | "tasks"
  | "projects"
  | "notices"
  | "skills"
  | "workflows"
  | "knowledge"
  | "ai"
  | "chat"
  | "profile";

export type ModuleMeta = {
  href: string;
  label: string;
  color: string;
  icon: ReactNode;
  adminOnly?: boolean;
};

export const MODULE_META: Record<ModuleKey, ModuleMeta> = {
  dashboard: {
    href: "/",
    label: "工作概览",
    color: "#61778e",
    icon: <DashboardOutlined />,
  },
  tasks: {
    href: "/tasks",
    label: "任务",
    color: "#61778e",
    icon: <CheckSquareOutlined />,
  },
  projects: {
    href: "/projects",
    label: "项目",
    color: "#61778e",
    icon: <FolderOutlined />,
  },
  notices: {
    href: "/notices",
    label: "通知公告",
    color: "#61778e",
    icon: <NotificationOutlined />,
  },
  skills: {
    href: "/skills",
    label: "技能",
    color: "#61778e",
    icon: <ThunderboltOutlined />,
  },
  workflows: {
    href: "/workflows",
    label: "工作流",
    color: "#61778e",
    icon: <ApartmentOutlined />,
  },
  knowledge: {
    href: "/knowledge",
    label: "知识库",
    color: "#61778e",
    icon: <ReadOutlined />,
  },
  ai: {
    href: "/ai",
    label: "AI 助手",
    color: "#61778e",
    icon: <RobotOutlined />,
  },
  chat: {
    href: "/chat",
    label: "聊天会话",
    color: "#61778e",
    icon: <MessageOutlined />,
  },
  profile: {
    href: "/profile",
    label: "个人资料",
    color: "#61778e",
    icon: <UserOutlined />,
  },

};

/** 品牌主色（对齐《平台界面设计系统》品牌绿，antd 主题 token 同源） */
export const BRAND_COLOR = "#345d88";

/** 由任意主色生成同色系渐变（用于图标底、横幅等） */
export function moduleGradient(color: string): string {
  return color;
}

/** Navigation and homepage share the same module order. Profile stays in the account menu. */
export const DESK_GROUPS: { key: string; label: string; modules: ModuleKey[] }[] = [
  { key: "work", label: "日常工作", modules: ["tasks", "projects", "knowledge"] },
  { key: "collaboration", label: "团队协作", modules: ["chat", "notices"] },
  { key: "automation", label: "助手与自动化", modules: ["ai", "skills", "workflows"] },
];
export const DESK_PATH_GROUPS = Object.fromEntries(
  DESK_GROUPS.flatMap(group => group.modules.map(key => [MODULE_META[key].href, group.label])),
);
