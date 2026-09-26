import type { ReactNode } from "react";
import {
  ApartmentOutlined,
  AppstoreOutlined,
  CheckSquareOutlined,
  DatabaseOutlined,
  DeploymentUnitOutlined,
  FolderOutlined,
  HomeOutlined,
  HistoryOutlined,
  MessageOutlined,
  MonitorOutlined,
  NotificationOutlined,
  ReadOutlined,
  RobotOutlined,
  SafetyOutlined,
  ScheduleOutlined,
  TeamOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";

/**
 * 管理台菜单与路由元数据。
 * - SIDEBAR_MENU：侧边栏与首页共用的模块分组
 * - PATH_TITLES / PATH_GROUPS：多标签页与面包屑所用的路由标题映射
 * - MODULE_META / moduleGradient：模块视图内部仍使用的颜色与图标
 */

export type MenuLeaf = { key: string; label: string; icon: ReactNode };
export type MenuGroup = { key: string; label: string; icon: ReactNode; children: MenuLeaf[] };

export const SIDEBAR_MENU: MenuGroup[] = [
  {
    key: "grp-work", label: "业务管理", icon: <AppstoreOutlined />,
    children: [
      { key: "/tasks", label: "任务管理", icon: <CheckSquareOutlined /> },
      { key: "/projects", label: "项目管理", icon: <FolderOutlined /> },
      { key: "/knowledge", label: "知识管理", icon: <ReadOutlined /> },
    ],
  },
  {
    key: "grp-automation", label: "自动化配置", icon: <ApartmentOutlined />,
    children: [
      { key: "/skills", label: "技能管理", icon: <ThunderboltOutlined /> },
      { key: "/workflows", label: "工作流管理", icon: <ApartmentOutlined /> },
      { key: "/ai", label: "AI 配置", icon: <RobotOutlined /> },
      { key: "/monitor/job", label: "定时任务", icon: <ScheduleOutlined /> },
    ],
  },
  {
    key: "grp-team", label: "成员与协作", icon: <TeamOutlined />,
    children: [
      { key: "/users", label: "用户管理", icon: <TeamOutlined /> },
      { key: "/chat", label: "聊天管理", icon: <MessageOutlined /> },
      { key: "/notices", label: "通知管理", icon: <NotificationOutlined /> },
    ],
  },
  {
    key: "grp-monitor", label: "运行监控", icon: <MonitorOutlined />,
    children: [
      { key: "/monitor/server", label: "服务监控", icon: <MonitorOutlined /> },
      { key: "/monitor/online", label: "在线用户", icon: <TeamOutlined /> },
      { key: "/monitor/druid", label: "数据监控", icon: <DeploymentUnitOutlined /> },
      { key: "/monitor/cache", label: "缓存监控", icon: <DatabaseOutlined /> },
    ],
  },
  {
    key: "grp-audit", label: "日志审计", icon: <SafetyOutlined />,
    children: [
      { key: "/monitor/job-log", label: "调度日志", icon: <HistoryOutlined /> },
      { key: "/monitor/logininfor", label: "登录日志", icon: <HistoryOutlined /> },
      { key: "/monitor/operlog", label: "操作日志", icon: <SafetyOutlined /> },
    ],
  },
];

export const HOME_MENU: MenuLeaf = { key: "/", label: "管理概览", icon: <HomeOutlined /> };

/** 路由 → 页面标题（TagsView 标签页标题） */
export const PATH_TITLES: Record<string, string> = {
  [HOME_MENU.key]: HOME_MENU.label,
  ...Object.fromEntries(SIDEBAR_MENU.flatMap((g) => g.children.map((c) => [c.key, c.label]))),
};

/** 路由 → 所属菜单分组（面包屑第二级） */
export const PATH_GROUPS: Record<string, string> = Object.fromEntries(
  SIDEBAR_MENU.flatMap((g) => g.children.map((c) => [c.key, g.label])),
);

/** 路由 → 所属分组 key（展开侧边栏菜单用） */
export const PATH_GROUP_KEYS: Record<string, string> = Object.fromEntries(
  SIDEBAR_MENU.flatMap((g) => g.children.map((c) => [c.key, g.key])),
);

/** 兼容旧模块视图：模块色与图标 */
export type ModuleKey =
  | "dashboard"
  | "users"
  | "tasks"
  | "projects"
  | "notices"
  | "skills"
  | "workflows"
  | "knowledge"
  | "ai"
  | "chat"
  | "monitor-server"
  | "monitor-online"
  | "monitor-job"
  | "monitor-druid"
  | "monitor-cache"
  | "monitor-job-log"
  | "monitor-operlog"
  | "monitor-logininfor";

export type ModuleMeta = {
  href: string;
  label: string;
  color: string;
  icon: ReactNode;
  adminOnly?: boolean;
};

export const MODULE_META: Record<ModuleKey, ModuleMeta> = {
  dashboard: { href: "/", label: "总览", color: "#1677ff", icon: <HomeOutlined /> },
  users: { href: "/users", label: "用户管理", color: "#1677ff", icon: <TeamOutlined /> },
  tasks: { href: "/tasks", label: "任务管理", color: "#13c2c2", icon: <CheckSquareOutlined /> },
  projects: { href: "/projects", label: "项目管理", color: "#2f54eb", icon: <FolderOutlined /> },
  notices: { href: "/notices", label: "通知管理", color: "#fa541c", icon: <NotificationOutlined /> },
  skills: { href: "/skills", label: "技能管理", color: "#13c2c2", icon: <ThunderboltOutlined /> },
  workflows: { href: "/workflows", label: "工作流管理", color: "#722ed1", icon: <ApartmentOutlined /> },
  knowledge: { href: "/knowledge", label: "知识管理", color: "#1677ff", icon: <ReadOutlined /> },
  ai: { href: "/ai", label: "AI 配置", color: "#722ed1", icon: <RobotOutlined /> },
  chat: { href: "/chat", label: "聊天管理", color: "#9254de", icon: <MessageOutlined /> },
  "monitor-server": { href: "/monitor/server", label: "服务监控", color: "#1677ff", icon: <MonitorOutlined /> },
  "monitor-online": { href: "/monitor/online", label: "在线用户", color: "#13c2c2", icon: <TeamOutlined /> },
  "monitor-job": { href: "/monitor/job", label: "定时任务", color: "#fa8c16", icon: <ScheduleOutlined /> },
  "monitor-druid": { href: "/monitor/druid", label: "数据监控", color: "#722ed1", icon: <DeploymentUnitOutlined /> },
  "monitor-cache": { href: "/monitor/cache", label: "缓存监控", color: "#fa541c", icon: <DatabaseOutlined /> },
  "monitor-job-log": { href: "/monitor/job-log", label: "调度日志", color: "#fa8c16", icon: <HistoryOutlined /> },
  "monitor-operlog": { href: "/monitor/operlog", label: "操作日志", color: "#13c2c2", icon: <SafetyOutlined /> },
  "monitor-logininfor": { href: "/monitor/logininfor", label: "登录日志", color: "#eb2f96", icon: <DatabaseOutlined /> },
};

/** 品牌主色（若依风格蓝） */
export const BRAND_COLOR = "#1677ff";

/** 由任意主色生成同色系渐变（模块视图内部使用） */
export function moduleGradient(color: string): string {
  return `linear-gradient(135deg, ${color}, ${color}99)`;
}
