/**
 * AI 输入框「/」内联命令面板 —— 数据层。
 *
 * 职责：
 *  - 定义技能 / 工作流两类可选项的统一类型（SlashItem / SlashGroup）。
 *  - 由传入的技能/工作流列表（引用）构建可选项。
 *  - 提供 query 过滤 + 分组 + 最近使用置顶能力。
 *
 * 为避免与 components/ai/AIView.tsx 形成循环依赖，本文件内联一份与 AIView
 * 的 ItemRef「结构兼容」的本地类型（id 用 string | number，以同时接纳
 * AIView 中 number 类型的技能和 id 字符串型命令；消费方负责落库时规整为 number）。
 */

import type { ComponentType } from "react";
import { CodeOutlined, PartitionOutlined } from "@ant-design/icons";

// ============ 类型 ============

/**
 * 与 AIView.ItemRef 结构兼容的本地副本。
 * id 取 string | number：AIView 中技能/工作流的 id 为 number，命令项则无真实 id。
 */
export type ItemRef = {
  id: string | number;
  name: string;
  displayName?: string;
  description?: string;
};

export type SlashItemType = "skill" | "workflow";
export type SlashGroupKey = "skill" | "workflow";

export type SlashPayload =
  | { kind: "skill"; item: ItemRef }
  | { kind: "workflow"; item: ItemRef };

export type SlashItem = {
  type: SlashItemType;
  /** 全局唯一 token，用于键盘高亮匹配与「最近使用」记录 */
  token: string;
  label: string;
  description?: string;
  icon?: ComponentType<any>;
  group: SlashGroupKey;
  /** 搜索关键字（已折叠为小写前的原始文案，过滤时统一 toLowerCase） */
  keywords: string[];
  payload: SlashPayload;
  /** 是否被「最近使用」命中（由 filterAndGroup 标注，可选） */
  recent?: boolean;
};

export type SlashGroup = {
  key: SlashGroupKey;
  title: string;
  items: SlashItem[];
};

// ============ 常量 ============

export const GROUP_KEYS: SlashGroupKey[] = ["skill", "workflow"];

export const GROUP_TITLES: Record<SlashGroupKey, string> = {
  skill: "技能",
  workflow: "工作流",
};

const RECENT_KEY = "alon.slash.recent";
const RECENT_MAX = 10;

// ============ 命令源 ============

export const SlashCommandSource = {
  /** 由技能列表生成可选项（token = skill:<id>） */
  buildSkillItems(skills: ItemRef[]): SlashItem[] {
    return skills.map((s) => ({
      type: "skill",
      token: `skill:${s.id}`,
      label: s.displayName || s.name,
      description: s.description,
      icon: CodeOutlined,
      group: "skill",
      keywords: [s.name, s.displayName || "", s.description || ""].filter(Boolean).map(String),
      payload: { kind: "skill", item: s },
    }));
  },

  /** 由工作流列表生成可选项（token = wf:<id>） */
  buildWorkflowItems(wfs: ItemRef[]): SlashItem[] {
    return wfs.map((w) => ({
      type: "workflow",
      token: `wf:${w.id}`,
      label: w.displayName || w.name,
      description: w.description,
      icon: PartitionOutlined,
      group: "workflow",
      keywords: [w.name, w.displayName || "", w.description || ""].filter(Boolean).map(String),
      payload: { kind: "workflow", item: w },
    }));
  },

  /**
   * 按 query 过滤并分组；空 query 返回全部分组（保持分组顺序）。
   * 命中 recentTokens 的项在同组内置顶并打「最近」标记。
   * @param query 用户输入的指令片段（不含前导 /）
   */
  filterAndGroup(query: string, groups: SlashGroup[], recentTokens: string[] = []): SlashGroup[] {
    const q = (query || "").trim().toLowerCase();
    const recentSet = recentTokens.length > 0 ? new Set(recentTokens) : null;
    const result: SlashGroup[] = [];

    for (const g of groups) {
      let items = g.items;
      if (q.length > 0) {
        items = items.filter((it) => it.keywords.join(" ").toLowerCase().includes(q));
      }
      if (items.length === 0) continue;

      if (recentSet) {
        items = items
          .map((it) => ({ ...it, recent: recentSet.has(it.token) }))
          .sort((a, b) => Number(b.recent) - Number(a.recent));
      }
      result.push({ ...g, items });
    }
    return result;
  },
};

// ============ 最近使用（localStorage） ============

/** 读取最近使用 token 列表（最多 RECENT_MAX 条） */
export function loadRecent(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((x): x is string => typeof x === "string").slice(0, RECENT_MAX);
  } catch {
    return [];
  }
}

/** 将 token 置顶写入最近使用（去重、最多 RECENT_MAX 条） */
export function pushRecent(token: string): void {
  if (typeof window === "undefined" || !token) return;
  try {
    const cur = loadRecent();
    const next = [token, ...cur.filter((t) => t !== token)].slice(0, RECENT_MAX);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* 忽略写入异常（如隐私模式） */
  }
}
