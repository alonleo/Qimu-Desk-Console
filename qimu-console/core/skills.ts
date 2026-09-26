/**
 * 技能类型定义（纯类型，无副作用）。
 * 供前端组件使用；数据由 Spring Boot 后端提供。
 */

export type SkillType = "shell" | "prompt" | "http";

export type SkillParam = {
  name: string;
  label?: string;
  required?: boolean;
  default?: string;
  description?: string;
  multiline?: boolean;
};

export type SkillConfig = {
  shell?: { command: string; timeout?: number };
  prompt?: { template: string };
  http?: {
    method?: string;
    url: string;
    headers?: Record<string, string>;
    body?: string;
    timeout?: number;
  };
};

export type SkillDefinition = {
  name: string;
  displayName?: string;
  description?: string;
  type: SkillType;
  color?: string;
  params: SkillParam[];
  config: SkillConfig;
  dir: string;
  source: string;
};

export type SkillRecord = {
  id: number;
  name: string;
  type: SkillType;
  displayName: string;
  description: string;
  color: string;
  params: SkillParam[];
  config: SkillConfig;
  dir: string;
  source: string;
  runCount: number;
  lastRunAt: string | null;
  lastRunStatus: string | null;
};

export type RunItem = {
  id: number;
  skill_id: number;
  skill_name: string;
  status: string;
  input?: string | null;
  output?: string | null;
  error?: string | null;
  duration_ms?: number | null;
  triggered_by?: string | null;
  started_at: string;
  finished_at?: string | null;
};

export type ScanError = { dir: string; error: string };

export type RunResult = {
  runId: number;
  status: "success" | "failed";
  output: string;
  error: string;
  durationMs: number;
};

export type SyncResult = { added: number; updated: number; removed: number; errors: ScanError[] };

/** 类型默认色 */
export const TYPE_COLORS: Record<SkillType, string> = {
  shell: "#52c41a",
  prompt: "#722ed1",
  http: "#13c2c2",
};
