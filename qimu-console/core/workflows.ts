/**
 * 工作流类型定义（纯类型，无副作用）。
 * 供前端组件使用；数据由 Spring Boot 后端提供。
 */

export type StepType = "shell" | "http" | "template" | "skill" | "llm";

export type StepShell = { command: string; timeout?: number };
export type StepHttp = {
  method?: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
  timeout?: number;
};
export type StepTemplate = { content: string };
export type StepSkill = { name: string; params?: Record<string, string> };
export type StepLlm = { prompt: string; system?: string };

export type WorkflowStep = {
  id: string;
  name?: string;
  type: StepType;
  shell?: StepShell;
  http?: StepHttp;
  template?: StepTemplate;
  skill?: StepSkill;
  llm?: StepLlm;
};

export type WorkflowDefinition = {
  name: string;
  displayName?: string;
  description?: string;
  color?: string;
  params: import("./skills").SkillParam[];
  steps: WorkflowStep[];
  file: string;
  source: string;
};

export type StepLog = {
  stepId: string;
  name: string;
  type: StepType;
  status: "success" | "failed" | "skipped";
  output: string;
  error: string;
  durationMs: number;
};

export type WorkflowRunResult = {
  runId: number;
  status: "success" | "failed";
  durationMs: number;
  steps: StepLog[];
  error: string;
};

export type WorkflowRecord = {
  id: number;
  name: string;
  displayName: string;
  description: string;
  color: string;
  params: import("./skills").SkillParam[];
  steps: { id: string; name: string; type: StepType }[];
  stepCount: number;
  version: number;
  source: string;
  runCount: number;
  lastRunAt: string | null;
  lastRunStatus: string | null;
};

export type WorkflowRunItem = {
  id: number;
  workflow_id: number;
  workflow_name: string;
  status: string;
  trigger: string | null;
  triggered_by?: string | null;
  duration_ms: number | null;
  started_at: string;
  finished_at: string | null;
  steps: StepLog[];
};

export type ScanError = { file: string; error: string };
export type SyncResult = { added: number; updated: number; removed: number; errors: ScanError[] };

/** 步骤类型默认色 */
export const STEP_COLORS: Record<StepType, string> = {
  shell: "#52c41a",
  http: "#13c2c2",
  template: "#1677ff",
  skill: "#eb2f96",
  llm: "#fa8c16",
};
