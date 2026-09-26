import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import {
  row,
  rows,
  exec as dbExec,
  withTransaction,
  nowString,
  withColumnFallback,
  ensureSourceColumns,
  isBadFieldError,
  isDuplicateKeyError,
} from "./db";
import { runShell, runHttp } from "./executor";
import {
  runSkill,
  syncSkills,
  deletedSeedNames,
  isSourceMarker,
  normalizeSourceValue,
  validateSkillParams,
  coerceSkillConfig,
  type SkillParam,
} from "./skills";
import { chatLlm, getAiConfig, aiReady } from "./llm";
import {
  VISIBILITY_PUBLIC,
  memberScopeSql,
  normalizeVisibility,
  type VisibilityValue,
} from "./visibility";
import { ensureVisibilityColumns } from "./db";
import type { SourceValue, SaveResult } from "./ai/artifacts";

/** 工作流根目录（可用 WORKFLOWS_DIR 环境变量覆盖，Docker 部署时指向挂载卷） */
export const WORKFLOWS_DIR = process.env.WORKFLOWS_DIR || path.join(process.cwd(), "workflows");

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
  params: SkillParam[];
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
  params: SkillParam[];
  steps: { id: string; name: string; type: StepType }[];
  stepCount: number;
  version: number;
  /** 来源标识：manual | file | ai（权威 = DB 列，见 ARCHITECTURE §3.4） */
  source: SourceValue;
  /** 原始 YAML 定义文本（UI「查看定义」使用；文件播种/旧数据可能为空串） */
  sourceText: string;
  runCount: number;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  /** 可见性：personal | public（旧库缺列按 public，§六.4） */
  visibility?: VisibilityValue | null;
  /** 创建人 users.id；NULL = 系统通用数据 */
  owner_id?: number | null;
  /** 创建人展示名（详情一次查 users；列表缺省） */
  owner_name?: string | null;
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

const NAME_RE = /^[a-z][a-z0-9-]*$/;
const STEP_ID_RE = /^[A-Za-z_][A-Za-z0-9_-]*$/;

/** 步骤类型默认色 */
export const STEP_COLORS: Record<StepType, string> = {
  shell: "#52c41a",
  http: "#13c2c2",
  template: "#1677ff",
  skill: "#00c896",
  llm: "#fa8c16",
};

/**
 * 上下文模板渲染：支持 {{param}} 与 {{steps.<id>.output}} 两类点号路径。
 * 未知变量原样保留，便于发现问题。
 */
export function renderCtx(tpl: string, ctx: Record<string, unknown>): string {
  return tpl.replace(
    /\{\{\s*([A-Za-z_][A-Za-z0-9_.]*)\s*\}\}/g,
    (match, expr: string) => {
      let cur: unknown = ctx;
      for (const part of String(expr).split(".")) {
        if (cur && typeof cur === "object" && part in (cur as Record<string, unknown>)) {
          cur = (cur as Record<string, unknown>)[part];
        } else {
          return match;
        }
      }
      return cur === undefined || cur === null ? match : String(cur);
    }
  );
}

function parseStep(raw: unknown, index: number): { step?: WorkflowStep; error?: string } {
  if (!raw || typeof raw !== "object") return { error: `步骤 #${index + 1} 不是合法映射` };
  const s = raw as Record<string, unknown>;
  const id = typeof s.id === "string" ? s.id.trim() : "";
  if (!STEP_ID_RE.test(id)) {
    return { error: `步骤 #${index + 1} 的 id 必须是字母开头的标识（供 {{steps.<id>.output}} 引用）` };
  }
  const type = s.type as StepType;
  if (!["shell", "http", "template", "skill", "llm"].includes(String(type))) {
    return { error: `步骤「${id}」的 type 必须是 shell / http / template / skill / llm 之一` };
  }
  const step: WorkflowStep = {
    id,
    name: typeof s.name === "string" ? s.name : id,
    type,
  };

  if (type === "shell") {
    const c = (s.shell || {}) as Record<string, unknown>;
    if (typeof c.command !== "string" || !c.command.trim()) {
      return { error: `shell 步骤「${id}」必须提供 shell.command` };
    }
    step.shell = {
      command: c.command,
      timeout: typeof c.timeout === "number" ? c.timeout : undefined,
    };
  } else if (type === "http") {
    // 容错：AI 偶尔把 url/method 平铺在步骤顶层，统一归一进 http 子对象（嵌套已有值优先）
    const h = (coerceSkillConfig("http", s).http ?? {}) as Record<string, unknown>;
    if (typeof h.url !== "string" || !h.url.trim()) {
      return { error: `http 步骤「${id}」必须提供 http.url` };
    }
    const headers: Record<string, string> = {};
    if (h.headers && typeof h.headers === "object") {
      for (const [k, v] of Object.entries(h.headers as Record<string, unknown>)) {
        headers[k] = String(v ?? "");
      }
    }
    step.http = {
      method: typeof h.method === "string" ? h.method : undefined,
      url: h.url.trim(),
      headers: Object.keys(headers).length ? headers : undefined,
      body: typeof h.body === "string" ? h.body : undefined,
      timeout: typeof h.timeout === "number" ? h.timeout : undefined,
    };
  } else if (type === "template") {
    const t = (s.template || {}) as Record<string, unknown>;
    if (typeof t.content !== "string" || !t.content.trim()) {
      return { error: `template 步骤「${id}」必须提供 template.content` };
    }
    step.template = { content: t.content };
  } else if (type === "skill") {
    const k = (s.skill || {}) as Record<string, unknown>;
    if (typeof k.name !== "string" || !k.name.trim()) {
      return { error: `skill 步骤「${id}」必须提供 skill.name（技能中心注册名）` };
    }
    const params: Record<string, string> = {};
    if (k.params && typeof k.params === "object") {
      for (const [pk, pv] of Object.entries(k.params as Record<string, unknown>)) {
        params[pk] = String(pv ?? "");
      }
    }
    step.skill = { name: k.name.trim(), params };
  } else {
    // 容错：AI 偶尔把 prompt/system 平铺在步骤顶层，统一归一进 llm 子对象（嵌套已有值优先）
    const l = (coerceSkillConfig("llm", s).llm ?? {}) as Record<string, unknown>;
    if (typeof l.prompt !== "string" || !l.prompt.trim()) {
      return { error: `llm 步骤「${id}」必须提供 llm.prompt` };
    }
    step.llm = { prompt: l.prompt, system: typeof l.system === "string" ? l.system : undefined };
  }
  return { step };
}

function parseWorkflowFile(file: string, source: string): { def?: WorkflowDefinition; error?: string } {
  let raw: unknown;
  try {
    raw = YAML.parse(source);
  } catch (e) {
    return { error: `YAML 解析失败：${(e as Error).message}` };
  }
  if (!raw || typeof raw !== "object") return { error: "内容为空或不是合法映射" };
  const y = raw as Record<string, unknown>;

  const name = typeof y.name === "string" ? y.name.trim() : "";
  if (!NAME_RE.test(name)) {
    return { error: "name 必须是小写字母开头的 slug（可含数字、连字符）" };
  }
  if (!Array.isArray(y.steps) || y.steps.length === 0) {
    return { error: "steps 不能为空" };
  }

  const params: SkillParam[] = [];
  if (Array.isArray(y.params)) {
    for (const p of y.params) {
      if (!p || typeof p !== "object") continue;
      const o = p as Record<string, unknown>;
      const pn = typeof o.name === "string" ? o.name.trim() : "";
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(pn)) continue;
      params.push({
        name: pn,
        label: typeof o.label === "string" ? o.label : undefined,
        required: Boolean(o.required),
        default: typeof o.default === "string" ? o.default : undefined,
        description: typeof o.description === "string" ? o.description : undefined,
        multiline: Boolean(o.multiline),
      });
    }
  }

  const steps: WorkflowStep[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < (y.steps as unknown[]).length; i++) {
    const { step, error } = parseStep((y.steps as unknown[])[i], i);
    if (error) return { error };
    if (!step) continue;
    if (seen.has(step.id)) return { error: `步骤 id「${step.id}」重复` };
    seen.add(step.id);
    steps.push(step);
  }

  return {
    def: {
      name,
      displayName: typeof y.displayName === "string" ? y.displayName : undefined,
      description: typeof y.description === "string" ? y.description : undefined,
      color: typeof y.color === "string" ? y.color : undefined,
      params,
      steps,
      file,
      source,
    },
  };
}

/** 扫描 workflows/ 目录下的 *.yml / *.yaml */
export function scanWorkflows(): { definitions: WorkflowDefinition[]; errors: ScanError[] } {
  const definitions: WorkflowDefinition[] = [];
  const errors: ScanError[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(WORKFLOWS_DIR, { withFileTypes: true });
  } catch {
    return { definitions, errors: [{ file: WORKFLOWS_DIR, error: "workflows 目录不存在或不可读" }] };
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".yml") && !entry.name.endsWith(".yaml")) continue;
    if (entry.name.startsWith(".")) continue;
    try {
      const source = fs.readFileSync(path.join(WORKFLOWS_DIR, entry.name), "utf-8");
      const { def, error } = parseWorkflowFile(entry.name, source);
      if (def) definitions.push(def);
      else errors.push({ file: entry.name, error: error || "解析失败" });
    } catch (e) {
      errors.push({ file: entry.name, error: `读取失败：${(e as Error).message}` });
    }
  }
  return { definitions, errors };
}

/**
 * 与统一后的共享表对齐：文件目录只做「播种」。
 * 已存在的工作流以 DB（后台管理）为准，不再删除/覆盖后台维护的行。
 */
export async function syncWorkflows(): Promise<SyncResult> {
  const { definitions, errors } = scanWorkflows();
  const tombstones = await deletedSeedNames("workflow");
  let added = 0;
  await withTransaction(async (tx) => {
    for (const d of definitions) {
      if (tombstones.has(d.name)) continue; // 后台已删除 → 不复活
      const exist = await tx.row("SELECT id FROM workflows WHERE name = ?", [d.name]);
      if (exist) continue;
      const defJson = JSON.stringify({
        displayName: d.displayName || d.name,
        description: d.description || "",
        color: d.color || "#13c2c2",
        params: d.params,
        steps: d.steps,
        source: d.source,
        file: d.file,
      });
      try {
        // 播种 = 系统通用数据（§六.7）：显式 visibility='public'、owner_id=NULL，不受登录态影响
        await tx.exec(
          "INSERT INTO workflows (name, description, definition, version, visibility, owner_id) VALUES (?, ?, ?, 1, 'public', NULL)",
          [d.name, d.description || d.displayName || "", defJson]
        );
      } catch (e) {
        if (isBadFieldError(e)) {
          // 未迁移旧库：不写这两列，靠列默认值（public/NULL）落对（§六.7）
          await tx.exec(
            "INSERT INTO workflows (name, description, definition, version) VALUES (?, ?, ?, 1)",
            [d.name, d.description || d.displayName || "", defJson]
          );
        } else {
          throw e;
        }
      }
      added++;
    }
  });
  return { added, updated: 0, removed: 0, errors };
}

/** name 撞名回查（source 列存在时带出，缺列自动降级） */
export async function findWorkflowByName(
  name: string
): Promise<{ id: number; name: string; source?: string } | null> {
  const arr = await withColumnFallback<{ id: number; name: string; source?: string | null }>(
    "SELECT id, name, source FROM workflows WHERE name = ?",
    "SELECT id, name FROM workflows WHERE name = ?",
    [name]
  );
  const hit = arr[0];
  return hit ? { id: hit.id, name: hit.name, source: hit.source ?? undefined } : null;
}

/** 校验并清洗步骤数组：非空、id 唯一且合法、每步 type 配套子对象（复用 parseStep 深校验） */
function normalizeWorkflowSteps(raw: unknown): { steps: WorkflowStep[]; error?: string } {
  if (!Array.isArray(raw)) return { steps: [], error: "steps 必须是数组" };
  if (raw.length === 0) return { steps: [], error: "steps 不能为空" };
  const steps: WorkflowStep[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < raw.length; i++) {
    const { step, error } = parseStep(raw[i], i);
    if (error) return { steps: [], error };
    if (!step) return { steps: [], error: `步骤 #${i + 1} 解析失败` };
    if (seen.has(step.id)) return { steps: [], error: `步骤 id「${step.id}」重复` };
    seen.add(step.id);
    steps.push(step);
  }
  return { steps };
}

/**
 * 创建/覆盖工作流（AI 产物与三中心手动保存共用的写通道）。
 * - name 唯一由 UNIQUE 索引兜底：先 SELECT 给可读冲突，撞 1062 转 duplicate 并回查 existing；
 * - overwrite=true 时按 name UPDATE（description/definition 全量重写、version+1），未命中则 INSERT；
 * - 只落 DB，不写 workflows/<name>.yml；file 恒为 name + '.yml'（执行/展示兼容）；
 * - source 写列（definition JSON 内冗余 source 便于后台旧逻辑读取，权威是列）。
 */
export async function createWorkflow(
  input: {
    name: string;
    displayName?: string;
    description?: string;
    color?: string;
    params?: SkillParam[];
    steps: WorkflowStep[];
  },
  opts?: {
    source?: SourceValue;
    overwrite?: boolean;
    /** 服务端权威 owner_id（架构 §六.6） */
    ownerId?: number | null;
    /** 服务端归一化后的可见性 */
    visibility?: VisibilityValue;
  }
): Promise<SaveResult> {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) return { ok: false, status: "invalid", message: "工作流标识不能为空" };
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    return {
      ok: false,
      status: "invalid",
      message: "工作流标识不合法：需为小写字母或数字开头，可含数字、连字符（如 daily-report）",
    };
  }
  const { params, error: paramsError } = validateSkillParams(input.params);
  if (paramsError) return { ok: false, status: "invalid", message: paramsError };
  const { steps, error: stepsError } = normalizeWorkflowSteps(input.steps);
  if (stepsError) return { ok: false, status: "invalid", message: stepsError };

  const source = normalizeSourceValue(opts?.source);
  const displayName =
    typeof input.displayName === "string" && input.displayName.trim()
      ? input.displayName.trim()
      : name;
  const description = typeof input.description === "string" ? input.description.trim() : "";
  const color =
    typeof input.color === "string" && input.color.trim() ? input.color.trim() : "#13c2c2";
  const now = nowString();
  const definitionJson = JSON.stringify({
    displayName,
    description,
    color,
    params,
    steps,
    source,
    file: `${name}.yml`,
  });

  const existing = await findWorkflowByName(name);
  if (existing) {
    if (opts?.overwrite) {
      const visibility = normalizeVisibility(opts.visibility);
      try {
        if (visibility) {
          // 覆盖更新：visibility 同步改写；owner_id 保持原创建人不变
          await dbExec(
            `UPDATE workflows SET description = ?, definition = ?, version = version + 1, source = ?, visibility = ?, updated_at = ?
             WHERE id = ?`,
            [description, definitionJson, source, visibility, now, existing.id]
          );
        } else {
          await dbExec(
            `UPDATE workflows SET description = ?, definition = ?, version = version + 1, source = ?, updated_at = ?
             WHERE id = ?`,
            [description, definitionJson, source, now, existing.id]
          );
        }
      } catch (e) {
        if (isBadFieldError(e)) {
          // 旧库缺 visibility 列：降级为不带可见性的 UPDATE
          try {
            await dbExec(
              `UPDATE workflows SET description = ?, definition = ?, version = version + 1, source = ?, updated_at = ?
               WHERE id = ?`,
              [description, definitionJson, source, now, existing.id]
            );
          } catch (e2) {
            return {
              ok: false,
              status: "error",
              message: `覆盖工作流「${name}」失败：${(e2 as Error).message}`,
            };
          }
        } else {
          return {
            ok: false,
            status: "error",
            message: `覆盖工作流「${name}」失败：${(e as Error).message}`,
          };
        }
      }
      return { ok: true, id: existing.id, created: false, message: `已覆盖更新工作流「${name}」` };
    }
    return {
      ok: false,
      status: "duplicate",
      message: `工作流「${name}」已存在`,
      existing: { id: existing.id, name, source: existing.source },
    };
  }

  const visibility = normalizeVisibility(opts?.visibility) ?? VISIBILITY_PUBLIC;
  const ownerId = typeof opts?.ownerId === "number" && Number.isInteger(opts.ownerId) ? opts.ownerId : null;

  const insertWorkflow = async (): Promise<number> => {
    const info = await dbExec(
      `INSERT INTO workflows (name, description, definition, version, source, visibility, owner_id, created_at, updated_at)
       VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)`,
      [name, description, definitionJson, source, visibility, ownerId, now, now]
    );
    return info.insertId;
  };

  /** 旧库兜底 INSERT：不写可见性两列（列默认 public/NULL）；仅 visibility=public 时允许（personal 缺列会泄露隐私，必须报错） */
  const insertWorkflowLegacy = async (): Promise<number> => {
    const info = await dbExec(
      `INSERT INTO workflows (name, description, definition, version, source, created_at, updated_at)
       VALUES (?, ?, ?, 1, ?, ?, ?)`,
      [name, description, definitionJson, source, now, now]
    );
    return info.insertId;
  };

  let insertId: number;
  try {
    insertId = await insertWorkflow();
  } catch (e) {
    if (isBadFieldError(e)) {
      // 旧库缺列：先尝试自愈补列（source 与 visibility 两代迁移都兜底），
      // 仍缺列时仅 public 语义降级旧 INSERT（personal 必须报错，防隐私泄露）
      await ensureSourceColumns();
      const ensured = await ensureVisibilityColumns();
      if (ensured) {
        try {
          insertId = await insertWorkflow();
        } catch (e2) {
          if (isDuplicateKeyError(e2)) {
            const ex = await findWorkflowByName(name);
            return {
              ok: false,
              status: "duplicate",
              message: `工作流「${name}」已存在`,
              existing: ex ?? { id: 0, name },
            };
          }
          return {
            ok: false,
            status: "error",
            message: `保存工作流「${name}」失败：${(e2 as Error).message}`,
          };
        }
      } else if (visibility === VISIBILITY_PUBLIC) {
        try {
          insertId = await insertWorkflowLegacy();
        } catch (e2) {
          if (isDuplicateKeyError(e2)) {
            const ex = await findWorkflowByName(name);
            return {
              ok: false,
              status: "duplicate",
              message: `工作流「${name}」已存在`,
              existing: ex ?? { id: 0, name },
            };
          }
          return {
            ok: false,
            status: "error",
            message: `保存工作流「${name}」失败：${(e2 as Error).message}`,
          };
        }
      } else {
        return {
          ok: false,
          status: "error",
          message:
            "库结构未升级：workflows 表缺少 visibility/owner_id 列且自动补列失败，请先启动一次管理后台完成迁移",
        };
      }
    } else if (isDuplicateKeyError(e)) {
      const ex = await findWorkflowByName(name);
      return {
        ok: false,
        status: "duplicate",
        message: `工作流「${name}」已存在`,
        existing: ex ?? { id: 0, name },
      };
    } else {
      return {
        ok: false,
        status: "error",
        message: `保存工作流「${name}」失败：${(e as Error).message}`,
      };
    }
  }
  return { ok: true, id: insertId, created: true, message: `工作流「${name}」已保存` };
}

type WorkflowRow = {
  id: number;
  name: string;
  description: string | null;
  definition: string;
  version: number;
  /** source 列：迁移前不存在（withColumnFallback 降级后无此字段） */
  source?: string | null;
  /** visibility / owner_id：迁移前不存在（withColumnFallback 降级后无此字段） */
  visibility?: string | null;
  owner_id?: number | null;
  owner_name?: string | null;
  run_count?: number;
  last_run_at?: string | null;
  last_run_status?: string | null;
};

function rowToRecord(r: WorkflowRow): WorkflowRecord {
  let d: {
    displayName?: string;
    description?: string;
    color?: string;
    params?: SkillParam[];
    steps?: WorkflowStep[];
    yaml?: string;
    source?: string;
  };
  try {
    d = JSON.parse(r.definition) as typeof d;
  } catch {
    d = {};
  }
  const steps = d.steps || [];
  const jsonSource = d.source;
  // §3.4 读端归一化：原文展示优先 yaml key；旧数据把原文塞在 source key（非标记值）时兼容
  const sourceText =
    typeof d.yaml === "string"
      ? d.yaml
      : typeof jsonSource === "string" && !isSourceMarker(jsonSource)
        ? jsonSource
        : "";
  return {
    id: r.id,
    name: r.name,
    displayName: d.displayName || r.name,
    description: d.description || r.description || "",
    color: d.color || "#13c2c2",
    params: d.params || [],
    steps: steps.map((s) => ({ id: s.id, name: s.name || s.id, type: s.type })),
    stepCount: steps.length,
    version: r.version,
    source: normalizeSourceValue(r.source ?? (isSourceMarker(jsonSource) ? jsonSource : undefined)),
    sourceText,
    // 可见性：缺列/NULL 降级按 public（§六.4 宁多见不误伤）
    visibility: r.visibility === "personal" ? "personal" : "public",
    owner_id: r.owner_id ?? null,
    owner_name: r.owner_name ?? null,
    runCount: r.run_count ?? 0,
    lastRunAt: r.last_run_at ?? null,
    lastRunStatus: r.last_run_status ?? null,
  };
}

const RUN_STATS_SQL = `
  (SELECT COUNT(*) FROM runs r WHERE r.workflow_id = w.id) AS run_count,
  (SELECT r.started_at FROM runs r WHERE r.workflow_id = w.id ORDER BY r.id DESC LIMIT 1) AS last_run_at,
  (SELECT r.status FROM runs r WHERE r.workflow_id = w.id ORDER BY r.id DESC LIMIT 1) AS last_run_status
`;

const WORKFLOW_LIST_SQL_WITH = `
  SELECT w.id, w.name, w.description, w.definition, w.version, w.source, w.visibility, w.owner_id, ${RUN_STATS_SQL}
  FROM workflows w
`;

const WORKFLOW_LIST_SQL_LEGACY = `
  SELECT w.id, w.name, w.description, w.definition, w.version, ${RUN_STATS_SQL}
  FROM workflows w
`;

/**
 * 工作流列表（先播种一次文件目录，保证内置示例在全新库上可用）。
 * @param user 当前用户：member 追加 scope（自己创建的 + 通用），admin 全量
 * @param opts.mine P1 筛选：'1' 仅我的（owner_id=自己）；'public' 仅通用
 * 降级语义（§六.4）：缺列（1054）时改跑 legacy SQL 且不做任何可见性过滤。
 */
export async function listWorkflows(
  user: { id: number; role: "admin" | "member" } | null,
  opts: { mine?: "1" | "public" } = {}
): Promise<WorkflowRecord[]> {
  await syncWorkflows();
  const scope = memberScopeSql(user, "w");
  let where = "";
  const params: (string | number)[] = [];
  if (opts.mine === "1" && user) {
    where = " WHERE w.owner_id = ?";
    params.push(user.id);
  } else if (opts.mine === "public") {
    where = " WHERE w.visibility = 'public'";
  } else if (scope.clause) {
    where = scope.clause;
    params.push(...scope.params);
  }
  try {
    const all = await rows<WorkflowRow>(
      `${WORKFLOW_LIST_SQL_WITH}${where} ORDER BY LOWER(w.name), w.name`,
      params
    );
    return all.map(rowToRecord);
  } catch (e) {
    if (isBadFieldError(e)) {
      // 未迁移旧库：降级不过滤（宁多见不误伤），字段由 rowToRecord 按 public/NULL 补齐
      const all = await rows<WorkflowRow>(
        `${WORKFLOW_LIST_SQL_LEGACY} ORDER BY LOWER(w.name), w.name`
      );
      return all.map(rowToRecord);
    }
    throw e;
  }
}

/** 创建人展示名（详情一次查 users；用户不存在/未设置时回退 null） */
async function workflowOwnerNameOf(ownerId: number | null | undefined): Promise<string | null> {
  if (ownerId === null || ownerId === undefined) return null;
  const u = await row<{ display_name: string | null; username: string }>(
    "SELECT display_name, username FROM users WHERE id = ?",
    [ownerId]
  );
  if (!u) return null;
  return u.display_name && u.display_name.trim() ? u.display_name : u.username;
}

/** 详情 + 最近运行（含逐步日志；含 visibility/owner_id/owner_name，路由层负责 member 可读校验） */
export async function getWorkflowDetail(
  id: number
): Promise<{ workflow: WorkflowRecord; runs: WorkflowRunItem[] } | null> {
  let r: WorkflowRow | null;
  try {
    const arr = await rows<WorkflowRow>(`${WORKFLOW_LIST_SQL_WITH} WHERE w.id = ?`, [id]);
    r = arr[0] ?? null;
  } catch (e) {
    if (isBadFieldError(e)) {
      const arr = await rows<WorkflowRow>(`${WORKFLOW_LIST_SQL_LEGACY} WHERE w.id = ?`, [id]);
      r = arr[0] ?? null;
    } else {
      throw e;
    }
  }
  if (!r) return null;
  const ownerName = await workflowOwnerNameOf(r.owner_id);
  const runs = await rows<WorkflowRunItem & { logs: string | null }>(
    `SELECT r.id, r.workflow_id, w.name AS workflow_name, r.status, r.\`trigger\`, r.triggered_by,
            r.duration_ms, r.started_at, r.finished_at, r.logs
     FROM runs r JOIN workflows w ON w.id = r.workflow_id
     WHERE r.workflow_id = ? ORDER BY r.id DESC LIMIT 10`,
    [id]
  );
  return {
    workflow: rowToRecord({ ...r, owner_name: ownerName }),
    runs: runs.map(({ logs, ...rest }) => ({ ...rest, steps: parseStepLogs(logs) })),
  };
}

/** 运行历史（可按工作流过滤），含逐步日志 */
export async function listWorkflowRuns(workflowId?: number, limit = 20): Promise<WorkflowRunItem[]> {
  const lim = Math.min(Math.max(limit, 1), 100);
  const where = workflowId ? "WHERE r.workflow_id = ?" : "";
  const params = workflowId ? [workflowId] : [];
  const all = await rows<WorkflowRunItem & { logs: string | null }>(
    `SELECT r.id, r.workflow_id, w.name AS workflow_name, r.status, r.\`trigger\`, r.triggered_by,
            r.duration_ms, r.started_at, r.finished_at, r.logs
     FROM runs r JOIN workflows w ON w.id = r.workflow_id
     ${where}
     ORDER BY r.id DESC LIMIT ${lim}`,
    params
  );
  return all.map(({ logs, ...rest }) => ({
    ...rest,
    steps: parseStepLogs(logs).map((s) => ({ ...s, output: s.output.slice(0, 20000) })),
  }));
}

function parseStepLogs(logs: string | null): StepLog[] {
  if (!logs) return [];
  try {
    const arr = JSON.parse(logs);
    return Array.isArray(arr) ? (arr as StepLog[]) : [];
  } catch {
    return [];
  }
}

/** 单步执行（已渲染上下文），按类型分发到子执行器 */
async function execStep(
  step: WorkflowStep,
  ctx: Record<string, unknown>,
  baseUrl?: string
): Promise<{ output: string; error: string }> {
  switch (step.type) {
    case "shell":
      return execShellStep(step, ctx);
    case "http":
      return execHttpStep(step, ctx, baseUrl);
    case "template":
      return execTemplateStep(step, ctx);
    case "skill":
      return execSkillStep(step, ctx);
    case "llm":
      return execLlmStep(step, ctx);
    default:
      return { output: "", error: `未知步骤类型：${step.type}` };
  }
}

async function execShellStep(
  step: WorkflowStep,
  ctx: Record<string, unknown>
): Promise<{ output: string; error: string }> {
  const shell = step.shell;
  if (!shell) return { output: "", error: "shell 步骤缺少 shell.command" };
  const command = renderCtx(shell.command, ctx);
  return runShell({ command, timeoutSec: shell.timeout });
}

async function execHttpStep(
  step: WorkflowStep,
  ctx: Record<string, unknown>,
  baseUrl?: string
): Promise<{ output: string; error: string }> {
  const http = step.http;
  if (!http) return { output: "", error: "http 步骤缺少 http.url" };
  let url = renderCtx(http.url, ctx);
  // 相对 URL 自动补全为当前站点（反代场景取转发头）
  if (url.startsWith("/") && baseUrl) url = baseUrl + url;
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(http.headers || {})) {
    headers[k] = renderCtx(v, ctx);
  }
  return runHttp({
    method: http.method,
    url,
    headers,
    body: http.body ? renderCtx(http.body, ctx) : undefined,
    timeoutSec: http.timeout,
  });
}

async function execTemplateStep(
  step: WorkflowStep,
  ctx: Record<string, unknown>
): Promise<{ output: string; error: string }> {
  if (!step.template) return { output: "", error: "template 步骤缺少内容" };
  return { output: renderCtx(step.template.content, ctx).trim() || "（无输出）", error: "" };
}

async function execSkillStep(
  step: WorkflowStep,
  ctx: Record<string, unknown>
): Promise<{ output: string; error: string }> {
  const sk = step.skill;
  if (!sk) return { output: "", error: "skill 步骤缺少 skill.name" };
  // 参数值支持上下文渲染（如 name: "{{owner}}"）
  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(sk.params || {})) {
    params[k] = renderCtx(v, ctx);
  }
  let found = await row<{ id: number }>("SELECT id FROM skills WHERE name = ?", [sk.name]);
  if (!found) {
    await syncSkills(); // 全新库尚未播种时兜底一次
    found = await row<{ id: number }>("SELECT id FROM skills WHERE name = ?", [sk.name]);
  }
  if (!found) {
    return { output: "", error: `技能「${sk.name}」未注册，请先在技能中心确认` };
  }
  const r = await runSkill(found.id, params, `workflow`);
  return { output: r.output, error: r.error };
}

async function execLlmStep(
  step: WorkflowStep,
  ctx: Record<string, unknown>
): Promise<{ output: string; error: string }> {
  const llm = step.llm;
  if (!llm) return { output: "", error: "llm 步骤缺少 llm.prompt" };
  const cfg = await getAiConfig();
  if (!aiReady(cfg)) {
    return {
      output: "",
      error: "AI 网关未配置：请先在工作台「AI 助手 → 网关设置」中填写 Base URL / API Key / 模型并启用",
    };
  }
  const rendered = renderCtx(llm.prompt, ctx).trim();
  const messages: { role: "system" | "user"; content: string }[] = [];
  if (llm.system?.trim()) {
    messages.push({ role: "system", content: renderCtx(llm.system, ctx).trim() });
  }
  messages.push({ role: "user", content: rendered });
  const r = await chatLlm({ messages, cfg });
  if (!r.ok) return { output: "", error: r.error };
  return { output: r.content, error: "" };
}

/** 读取工作流定义并组装运行参数（默认值兜底 + 必填校验），失败抛错 */
async function prepareWorkflowRun(workflowId: number, input: Record<string, unknown>) {
  const r = await row<{ id: number; name: string; definition: string }>(
    "SELECT id, name, definition FROM workflows WHERE id = ?",
    [workflowId]
  );
  if (!r) throw new Error("工作流不存在");

  let d: { params?: SkillParam[]; steps?: WorkflowStep[] };
  try {
    d = JSON.parse(r.definition) as typeof d;
  } catch {
    d = {};
  }
  const steps = d.steps || [];

  const params: Record<string, string> = {};
  for (const p of d.params || []) {
    const v = input?.[p.name];
    params[p.name] = v === undefined || v === null ? p.default ?? "" : String(v);
  }
  for (const p of d.params || []) {
    if (p.required && !params[p.name].trim()) {
      throw new Error(`参数「${p.label || p.name}」为必填项`);
    }
  }
  return { workflow: r, steps, params };
}

/**
 * 执行一次已创建的运行记录：顺序执行步骤，任一步失败即终止（后续步骤标记 skipped），
 * 每步状态/输出/耗时写入 runs.logs（JSON）。
 * 整体 try/catch 兜底：后台执行异常时也保证 runs 状态最终落库为 failed，不会永远停在 running。
 */
async function executeWorkflowRun(opts: {
  workflowId: number;
  runId: number;
  steps: WorkflowStep[];
  params: Record<string, string>;
  baseUrl?: string;
}): Promise<WorkflowRunResult> {
  const { runId, steps, params, baseUrl } = opts;
  const started = Date.now();
  const stepLogs: StepLog[] = [];
  const stepOutputs: Record<string, { output: string }> = {};
  let failed = false;
  let failError = "";

  try {
    for (const step of steps) {
      if (failed) {
        stepLogs.push({
          stepId: step.id,
          name: step.name || step.id,
          type: step.type,
          status: "skipped",
          output: "",
          error: "",
          durationMs: 0,
        });
        continue;
      }
      const ctx: Record<string, unknown> = { ...params, steps: { ...stepOutputs } };
      const t0 = Date.now();
      let output = "";
      let error = "";
      try {
        ({ output, error } = await execStep(step, ctx, baseUrl));
      } catch (e) {
        output = "";
        error = (e as Error).message || "步骤执行异常";
      }
      const durationMs = Date.now() - t0;
      if (error) {
        failed = true;
        failError = `步骤「${step.name || step.id}」失败：${error}`;
        stepLogs.push({
          stepId: step.id,
          name: step.name || step.id,
          type: step.type,
          status: "failed",
          output,
          error,
          durationMs,
        });
      } else {
        stepOutputs[step.id] = { output };
        stepLogs.push({
          stepId: step.id,
          name: step.name || step.id,
          type: step.type,
          status: "success",
          output,
          error: "",
          durationMs,
        });
      }
    }
  } catch (e) {
    failed = true;
    failError = `执行器异常：${(e as Error).message}`;
  }

  const status: "success" | "failed" = failed ? "failed" : "success";
  const durationMs = Date.now() - started;
  await dbExec(
    "UPDATE runs SET status = ?, finished_at = NOW(), duration_ms = ?, logs = ? WHERE id = ?",
    [status, durationMs, JSON.stringify(stepLogs), runId]
  );

  return { runId, status, durationMs, steps: stepLogs, error: failed ? failError : "" };
}

/** 同步执行：等待全部步骤跑完再返回结果（Hub 面板等需要即时结果的场景） */
export async function runWorkflow(
  workflowId: number,
  input: Record<string, unknown>,
  triggeredBy: string,
  baseUrl?: string
): Promise<WorkflowRunResult> {
  const prep = await prepareWorkflowRun(workflowId, input);
  const info = await dbExec(
    "INSERT INTO runs (workflow_id, status, `trigger`, triggered_by) VALUES (?, 'running', 'manual', ?)",
    [prep.workflow.id, triggeredBy]
  );
  return executeWorkflowRun({
    workflowId: prep.workflow.id,
    runId: info.insertId,
    steps: prep.steps,
    params: prep.params,
    baseUrl,
  });
}

/**
 * 异步执行：创建运行记录后立即返回 runId，后台继续执行并落库。
 * 前端通过轮询 /api/workflow-runs 获取最终状态（避免长耗时 LLM/HTTP 步骤卡住请求）。
 */
export async function startWorkflowRun(
  workflowId: number,
  input: Record<string, unknown>,
  triggeredBy: string,
  baseUrl?: string
): Promise<{ runId: number }> {
  const prep = await prepareWorkflowRun(workflowId, input);
  const info = await dbExec(
    "INSERT INTO runs (workflow_id, status, `trigger`, triggered_by) VALUES (?, 'running', 'manual', ?)",
    [prep.workflow.id, triggeredBy]
  );
  const runId = info.insertId;
  void executeWorkflowRun({
    workflowId: prep.workflow.id,
    runId,
    steps: prep.steps,
    params: prep.params,
    baseUrl,
  }).catch(() => {
    /* executeWorkflowRun 内部已兜底落库，这里仅防未处理 rejection */
  });
  return { runId };
}
