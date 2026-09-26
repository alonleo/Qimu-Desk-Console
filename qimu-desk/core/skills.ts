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
  ensureVisibilityColumns,
  isBadFieldError,
  isDuplicateKeyError,
} from "./db";
import { runShell, runHttp } from "./executor";
import type { SourceValue, SaveResult } from "./ai/artifacts";
import {
  VISIBILITY_PUBLIC,
  memberScopeSql,
  normalizeVisibility,
  type VisibilityValue,
} from "./visibility";

/** 技能根目录（可用 SKILLS_DIR 环境变量覆盖，Docker 部署时指向挂载卷） */
export const SKILLS_DIR = process.env.SKILLS_DIR || path.join(process.cwd(), "skills");

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
  /** 来源标识：manual | file | ai（权威 = DB 列，见 ARCHITECTURE §3.4） */
  source: SourceValue;
  /** 原始 YAML 定义文本（UI「查看定义」使用；文件播种/旧数据可能为空串） */
  sourceText: string;
  /** 可见性：personal | public（旧库缺列降级时按 public 处理，§六.4） */
  visibility?: VisibilityValue | null;
  /** 创建人 users.id；NULL = 系统通用数据 */
  owner_id?: number | null;
  /** 创建人展示名（详情接口一次查 users 组装；列表可能缺省） */
  owner_name?: string | null;
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

const NAME_RE = /^[a-z][a-z0-9-]*$/;

/**
 * 写接口 name 正则：与 admin Spring（SkillController）对齐，
 * 首字符允许小写字母或数字（AI 产物可能以数字开头）。
 */
const CREATE_NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

/** 是否属于「来源标记值」：manual/file/ai/admin 之一（用于区分历史 JSON 存的是标识还是原始文本） */
export function isSourceMarker(v: unknown): boolean {
  return typeof v === "string" && ["manual", "file", "ai", "admin"].includes(v);
}

/** 来源标识归一化：仅 ai/file 原样保留；admin 与一切未知值 → manual */
export function normalizeSourceValue(v: unknown): SourceValue {
  if (v === "ai") return "ai";
  if (v === "file") return "file";
  return "manual";
}

/** 类型默认色（skill.yml 未指定 color 时兜底） */
export const TYPE_COLORS: Record<SkillType, string> = {
  shell: "#52c41a",
  prompt: "#00c896",
  http: "#13c2c2",
};

/** {{var}} 模板渲染：未知变量原样保留，便于发现问题 */
export function renderTemplate(tpl: string, params: Record<string, string>): string {
  return tpl.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (match, key: string) => {
    const value = params[key];
    return value === undefined || value === null ? match : String(value);
  });
}

/** 解析单个参数定义；name 不合法返回 null（供文件扫描与写接口共用） */
export function parseParam(raw: unknown): SkillParam | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  const name = typeof p.name === "string" ? p.name.trim() : "";
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return null;
  return {
    name,
    label: typeof p.label === "string" ? p.label : undefined,
    required: Boolean(p.required),
    default: typeof p.default === "string" ? p.default : undefined,
    description: typeof p.description === "string" ? p.description : undefined,
    multiline: Boolean(p.multiline),
  };
}

/** 校验写接口 params：必须为数组，逐项 name 合法（返回统一错误文案或清洗后的参数列表） */
export function validateSkillParams(raw: unknown): { params: SkillParam[]; error?: string } {
  if (raw === undefined || raw === null) return { params: [] };
  if (!Array.isArray(raw)) return { params: [], error: "params 必须是数组" };
  const params: SkillParam[] = [];
  for (let i = 0; i < raw.length; i++) {
    const parsed = parseParam(raw[i]);
    if (!parsed) {
      return { params: [], error: `参数 #${i + 1} 不合法：name 需为字母开头（可含数字、下划线）` };
    }
    params.push(parsed);
  }
  return { params };
}

function parseSkillFile(file: string, dir: string, source: string): { def?: SkillDefinition; error?: string } {
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
  if (y.type !== "shell" && y.type !== "prompt" && y.type !== "http") {
    return { error: "type 必须是 shell / prompt / http 之一" };
  }
  const type = y.type as SkillType;

  const params = Array.isArray(y.params)
    ? (y.params.map(parseParam).filter(Boolean) as SkillParam[])
    : [];

  const config: SkillConfig = {};
  if (type === "shell") {
    const s = (y.shell || {}) as Record<string, unknown>;
    const command = typeof s.command === "string" ? s.command.trim() : "";
    if (!command) return { error: "shell 技能必须提供 shell.command" };
    config.shell = { command, timeout: typeof s.timeout === "number" ? s.timeout : undefined };
  } else if (type === "prompt") {
    const p = (y.prompt || {}) as Record<string, unknown>;
    const template = typeof p.template === "string" ? p.template : "";
    if (!template.trim()) return { error: "prompt 技能必须提供 prompt.template" };
    config.prompt = { template };
  } else {
    const h = (y.http || {}) as Record<string, unknown>;
    const url = typeof h.url === "string" ? h.url.trim() : "";
    if (!url) return { error: "http 技能必须提供 http.url" };
    const headers: Record<string, string> = {};
    if (h.headers && typeof h.headers === "object") {
      for (const [k, v] of Object.entries(h.headers as Record<string, unknown>)) {
        headers[k] = String(v ?? "");
      }
    }
    config.http = {
      method: typeof h.method === "string" ? h.method : undefined,
      url,
      headers: Object.keys(headers).length ? headers : undefined,
      body: typeof h.body === "string" ? h.body : undefined,
      timeout: typeof h.timeout === "number" ? h.timeout : undefined,
    };
  }

  return {
    def: {
      name,
      displayName: typeof y.displayName === "string" ? y.displayName : undefined,
      description: typeof y.description === "string" ? y.description : undefined,
      type,
      color: typeof y.color === "string" ? y.color : undefined,
      params,
      config,
      dir,
      source,
    },
  };
}

/** 扫描 skills/ 目录，返回全部合法定义与错误清单 */
export function scanSkills(): { definitions: SkillDefinition[]; errors: ScanError[] } {
  const definitions: SkillDefinition[] = [];
  const errors: ScanError[] = [];
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });
  } catch {
    return { definitions, errors: [{ dir: SKILLS_DIR, error: "skills 目录不存在或不可读" }] };
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const dir = entry.name;
    const yml = ["skill.yml", "skill.yaml"]
      .map((f) => path.join(SKILLS_DIR, dir, f))
      .find((f) => fs.existsSync(f));
    if (!yml) {
      errors.push({ dir, error: "缺少 skill.yml 定义文件" });
      continue;
    }
    try {
      const source = fs.readFileSync(yml, "utf-8");
      const { def, error } = parseSkillFile(yml, dir, source);
      if (def) definitions.push(def);
      else errors.push({ dir, error: error || "解析失败" });
    } catch (e) {
      errors.push({ dir, error: `读取失败：${(e as Error).message}` });
    }
  }
  return { definitions, errors };
}

export type SyncResult = { added: number; updated: number; removed: number; errors: ScanError[] };

/**
 * 墓碑名单：管理后台（admin-backend）删除技能/工作流时会写入 deleted_seeds 表，
 * 文件播种据此跳过同名目录/文件，避免「后台删除 → 文件播种又复活」。
 * 表由 admin-backend 负责创建；本表不存在（旧库未升级）时视为无墓碑。
 */
export async function deletedSeedNames(kind: "skill" | "workflow"): Promise<Set<string>> {
  try {
    const rs = await rows<{ name: string }>("SELECT name FROM deleted_seeds WHERE kind = ?", [kind]);
    return new Set(rs.map((r) => r.name));
  } catch {
    return new Set();
  }
}

/**
 * 与统一后的共享表对齐：文件目录只做「播种」，不再删除后台新建/改过的行。
 * 已存在的技能以 DB（后台管理）为准，避免两进程互相覆盖；
 * 后台已删除的（墓碑）不再从文件复活。
 */
export async function syncSkills(): Promise<SyncResult> {
  const { definitions, errors } = scanSkills();
  const tombstones = await deletedSeedNames("skill");
  let added = 0;
  await withTransaction(async (tx) => {
    for (const d of definitions) {
      if (tombstones.has(d.name)) continue; // 后台已删除 → 不复活
      const exist = await tx.row("SELECT id FROM skills WHERE name = ?", [d.name]);
      if (exist) continue; // DB 已有 → 以后台为准，不覆盖
      const configJson = JSON.stringify({
        displayName: d.displayName || d.name,
        description: d.description || "",
        color: d.color || TYPE_COLORS[d.type],
        params: d.params,
        config: d.config,
        dir: d.dir,
        source: d.source,
      });
      try {
        // 播种 = 系统通用数据（§六.7）：显式 visibility='public'、owner_id=NULL，不受登录态影响
        await tx.exec(
          `INSERT INTO skills (name, type, description, config, visibility, owner_id)
           VALUES (?, ?, ?, ?, 'public', NULL)`,
          [d.name, d.type, d.description || d.displayName || "", configJson]
        );
      } catch (e) {
        if (isBadFieldError(e)) {
          // 未迁移旧库：不写这两列，靠列默认值（public/NULL）落对（§六.7）
          await tx.exec(
            `INSERT INTO skills (name, type, description, config)
             VALUES (?, ?, ?, ?)`,
            [d.name, d.type, d.description || d.displayName || "", configJson]
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

type SkillRow = {
  id: number;
  name: string;
  type: SkillType;
  description: string | null;
  config: string;
  /** source 列：迁移前不存在（withColumnFallback 降级后无此字段） */
  source?: string | null;
  /** visibility / owner_id：迁移前不存在（withColumnFallback 降级后无此字段） */
  visibility?: string | null;
  owner_id?: number | null;
  owner_name?: string | null;
  last_run_at: string | null;
  run_count?: number;
  last_run_status?: string | null;
};

function rowToRecord(r: SkillRow): SkillRecord {
  let c: {
    displayName?: string;
    description?: string;
    color?: string;
    params?: SkillParam[];
    config: SkillConfig;
    dir?: string;
    yaml?: string;
    source?: string;
  };
  try {
    c = JSON.parse(r.config) as typeof c;
  } catch {
    c = { config: {} };
  }
  const jsonSource = c.source;
  // §3.4 读端归一化：原文展示优先 yaml key；旧数据把原文塞在 source key（非标记值）时兼容
  const sourceText =
    typeof c.yaml === "string"
      ? c.yaml
      : typeof jsonSource === "string" && !isSourceMarker(jsonSource)
        ? jsonSource
        : "";
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    displayName: c.displayName || r.name,
    description: c.description || r.description || "",
    color: c.color || TYPE_COLORS[r.type],
    params: c.params || [],
    config: c.config || {},
    dir: c.dir || r.name,
    source: normalizeSourceValue(r.source ?? (isSourceMarker(jsonSource) ? jsonSource : undefined)),
    sourceText,
    // 可见性：缺列/NULL 降级按 public（§六.4 宁多见不误伤）
    visibility: r.visibility === "personal" ? "personal" : "public",
    owner_id: r.owner_id ?? null,
    owner_name: r.owner_name ?? null,
    runCount: r.run_count ?? 0,
    lastRunAt: r.last_run_at,
    lastRunStatus: r.last_run_status ?? null,
  };
}

const SKILL_LIST_SQL_WITH = `
  SELECT s.id, s.name, s.type, s.description, s.config, s.source, s.visibility, s.owner_id, s.last_run_at,
         (SELECT COUNT(*) FROM skill_runs r WHERE r.skill_id = s.id) AS run_count,
         (SELECT r.status FROM skill_runs r WHERE r.skill_id = s.id ORDER BY r.id DESC LIMIT 1) AS last_run_status
  FROM skills s
`;

const SKILL_LIST_SQL_LEGACY = `
  SELECT s.id, s.name, s.type, s.description, s.config, s.last_run_at,
         (SELECT COUNT(*) FROM skill_runs r WHERE r.skill_id = s.id) AS run_count,
         (SELECT r.status FROM skill_runs r WHERE r.skill_id = s.id ORDER BY r.id DESC LIMIT 1) AS last_run_status
  FROM skills s
`;

/**
 * 技能列表（先播种一次文件目录，保证内置示例在全新库上可用）。
 * @param user 当前用户：member 追加 scope（自己创建的 + 通用），admin 全量
 * @param opts.mine P1 筛选：'1' 仅我的（owner_id=自己）；'public' 仅通用
 * 降级语义（§六.4）：缺列（1054）时改跑 legacy SQL 且不做任何可见性过滤。
 */
export async function listSkills(
  user: { id: number; role: "admin" | "member" } | null,
  opts: { mine?: "1" | "public" } = {}
): Promise<SkillRecord[]> {
  await syncSkills();
  const scope = memberScopeSql(user, "s");
  let where = "";
  const params: (string | number)[] = [];
  if (opts.mine === "1" && user) {
    where = " WHERE s.owner_id = ?";
    params.push(user.id);
  } else if (opts.mine === "public") {
    where = " WHERE s.visibility = 'public'";
  } else if (scope.clause) {
    where = scope.clause;
    params.push(...scope.params);
  }
  try {
    const all = await rows<SkillRow>(
      `${SKILL_LIST_SQL_WITH}${where} ORDER BY LOWER(s.name), s.name`,
      params
    );
    return all.map(rowToRecord);
  } catch (e) {
    if (isBadFieldError(e)) {
      // 未迁移旧库：降级不过滤（宁多见不误伤），字段由 rowToRecord 按 public/NULL 补齐
      const all = await rows<SkillRow>(
        `${SKILL_LIST_SQL_LEGACY} ORDER BY LOWER(s.name), s.name`
      );
      return all.map(rowToRecord);
    }
    throw e;
  }
}

/** 创建人展示名（详情一次查 users；用户不存在/未设置时回退 null） */
async function ownerNameOf(ownerId: number | null | undefined): Promise<string | null> {
  if (ownerId === null || ownerId === undefined) return null;
  const u = await row<{ display_name: string | null; username: string }>(
    "SELECT display_name, username FROM users WHERE id = ?",
    [ownerId]
  );
  if (!u) return null;
  return u.display_name && u.display_name.trim() ? u.display_name : u.username;
}

/** 技能详情 + 最近 10 次执行（含 visibility/owner_id/owner_name，路由层负责 member 可读校验） */
export async function getSkillDetail(
  id: number
): Promise<{ skill: SkillRecord; runs: RunItem[] } | null> {
  let r: SkillRow | null;
  try {
    const arr = await rows<SkillRow>(`${SKILL_LIST_SQL_WITH} WHERE s.id = ?`, [id]);
    r = arr[0] ?? null;
  } catch (e) {
    if (isBadFieldError(e)) {
      const arr = await rows<SkillRow>(`${SKILL_LIST_SQL_LEGACY} WHERE s.id = ?`, [id]);
      r = arr[0] ?? null;
    } else {
      throw e;
    }
  }
  if (!r) return null;
  const ownerName = await ownerNameOf(r.owner_id);
  const runs = await rows<RunItem>(
    `SELECT id, skill_id, status, input, output, error, duration_ms, triggered_by, started_at, finished_at
     FROM skill_runs WHERE skill_id = ? ORDER BY id DESC LIMIT 10`,
    [id]
  );
  return { skill: rowToRecord({ ...r, owner_name: ownerName }), runs: runs.map(truncRun) };
}

function truncRun(r: RunItem): RunItem {
  return { ...r, output: r.output ? r.output.slice(0, 20000) : r.output };
}

/** 运行历史（可按技能过滤） */
export async function listRuns(skillId?: number, limit = 20): Promise<RunItem[]> {
  const lim = Math.min(Math.max(limit, 1), 100);
  const where = skillId ? "WHERE r.skill_id = ?" : "";
  const params = skillId ? [skillId] : [];
  const all = await rows<RunItem>(
    `SELECT r.id, r.skill_id, s.name AS skill_name, r.status, r.output, r.error,
            r.duration_ms, r.triggered_by, r.started_at, r.finished_at
     FROM skill_runs r JOIN skills s ON s.id = r.skill_id
     ${where}
     ORDER BY r.id DESC LIMIT ${lim}`,
    params
  );
  return all.map(truncRun);
}

/** name 撞名回查（source 列存在时带出，缺列自动降级） */
async function findSkillByName(
  name: string
): Promise<{ id: number; name: string; source?: string } | null> {
  const arr = await withColumnFallback<{ id: number; name: string; source?: string | null }>(
    "SELECT id, name, source FROM skills WHERE name = ?",
    "SELECT id, name FROM skills WHERE name = ?",
    [name]
  );
  const hit = arr[0];
  return hit ? { id: hit.id, name: hit.name, source: hit.source ?? undefined } : null;
}

function invalidResult(message: string): SaveResult {
  return { ok: false, status: "invalid", message };
}

function dbErrorResult(message: string): SaveResult {
  return { ok: false, status: "error", message };
}

/**
 * 容错归一化：AI 偶尔会把 http 配置平铺在 config 顶层（url/method/headers/body/timeout），
 * 这里统一搬运进 config.http（嵌套已有值优先，不覆盖），避免「明明给了 url 却报缺少」的假阴性。
 * 纯函数：返回新对象，不修改传入值。
 */
export function coerceSkillConfig(type: string, raw: unknown): Record<string, unknown> {
  const obj = raw && typeof raw === "object" ? { ...(raw as Record<string, unknown>) } : {};
  if (type === "http") {
    const FLAT_KEYS = ["method", "url", "headers", "body", "timeout"] as const;
    const nested =
      obj.http && typeof obj.http === "object" ? ({ ...(obj.http as Record<string, unknown>) } as Record<string, unknown>) : {};
    let moved = false;
    for (const k of FLAT_KEYS) {
      if (nested[k] === undefined && obj[k] !== undefined) {
        nested[k] = obj[k];
        moved = true;
      }
    }
    if (moved || (obj.http === undefined && nested.url !== undefined)) {
      for (const k of FLAT_KEYS) delete obj[k];
      obj.http = nested;
    }
  }
  if (type === "llm") {
    const FLAT_KEYS = ["prompt", "system"] as const;
    const nested =
      obj.llm && typeof obj.llm === "object" ? ({ ...(obj.llm as Record<string, unknown>) } as Record<string, unknown>) : {};
    let moved = false;
    for (const k of FLAT_KEYS) {
      if (nested[k] === undefined && obj[k] !== undefined) {
        nested[k] = obj[k];
        moved = true;
      }
    }
    if (moved || (obj.llm === undefined && nested.prompt !== undefined)) {
      for (const k of FLAT_KEYS) delete obj[k];
      obj.llm = nested;
    }
  }
  return obj;
}

/** 按 type 清洗并深校验 config：shell.command / prompt.template / http.url 为必填 */
function buildSkillConfig(type: string, raw: unknown): { config: SkillConfig; error?: string } {
  const obj = coerceSkillConfig(type, raw);
  if (type === "shell") {
    const s = (obj.shell && typeof obj.shell === "object" ? (obj.shell as Record<string, unknown>) : {});
    const command = typeof s.command === "string" ? s.command.trim() : "";
    if (!command) return { config: {}, error: "shell 技能必须提供 shell.command" };
    return { config: { shell: { command, timeout: typeof s.timeout === "number" ? s.timeout : undefined } } };
  }
  if (type === "prompt") {
    const p = (obj.prompt && typeof obj.prompt === "object" ? (obj.prompt as Record<string, unknown>) : {});
    const template = typeof p.template === "string" ? p.template : "";
    if (!template.trim()) return { config: {}, error: "prompt 技能必须提供 prompt.template" };
    return { config: { prompt: { template } } };
  }
  if (type === "http") {
    const h = (obj.http && typeof obj.http === "object" ? (obj.http as Record<string, unknown>) : {});
    const url = typeof h.url === "string" ? h.url.trim() : "";
    if (!url) return { config: {}, error: "http 技能必须提供 http.url" };
    const headers: Record<string, string> = {};
    if (h.headers && typeof h.headers === "object") {
      for (const [k, v] of Object.entries(h.headers as Record<string, unknown>)) {
        headers[k] = String(v ?? "");
      }
    }
    return {
      config: {
        http: {
          method: typeof h.method === "string" ? h.method : undefined,
          url,
          headers: Object.keys(headers).length ? headers : undefined,
          body: typeof h.body === "string" ? h.body : undefined,
          timeout: typeof h.timeout === "number" ? h.timeout : undefined,
        },
      },
    };
  }
  return { config: {}, error: "type 必须是 shell / prompt / http 之一" };
}

/**
 * 创建/覆盖技能（AI 产物与三中心手动保存共用的写通道）。
 * - name 唯一由 UNIQUE 索引兜底：先 SELECT 给可读冲突，撞 1062 转 duplicate 并回查 existing；
 * - overwrite=true 时按 name UPDATE（type/description/config 全量重写），未命中则 INSERT；
 * - 只落 DB，不写 skills/<name>/skill.yml；dir 恒为 name（执行/展示兼容）；
 * - source 写列（JSON 内冗余 source 便于后台旧逻辑读取，权威是列）。
 */
export async function createSkill(
  input: {
    name: string;
    type: SkillType;
    displayName?: string;
    description?: string;
    color?: string;
    params?: SkillParam[];
    config: SkillConfig;
  },
  opts?: {
    source?: SourceValue;
    overwrite?: boolean;
    /** 服务端权威 owner_id（架构 §六.6：不信任前端） */
    ownerId?: number | null;
    /** 服务端归一化后的可见性 */
    visibility?: VisibilityValue;
  }
): Promise<SaveResult> {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) return invalidResult("技能标识不能为空");
  if (!CREATE_NAME_RE.test(name)) {
    return invalidResult("技能标识不合法：需为小写字母或数字开头，可含数字、连字符（如 fetch-stats）");
  }
  const type = input.type;
  if (type !== "shell" && type !== "prompt" && type !== "http") {
    return invalidResult("技能类型需为 shell / prompt / http 之一");
  }
  const { params, error: paramsError } = validateSkillParams(input.params);
  if (paramsError) return invalidResult(paramsError);
  const { config, error: configError } = buildSkillConfig(type, input.config);
  if (configError) return invalidResult(configError);

  const source = normalizeSourceValue(opts?.source);
  const displayName =
    typeof input.displayName === "string" && input.displayName.trim() ? input.displayName.trim() : name;
  const description = typeof input.description === "string" ? input.description.trim() : "";
  const color =
    typeof input.color === "string" && input.color.trim() ? input.color.trim() : TYPE_COLORS[type];
  const now = nowString();
  const configJson = JSON.stringify({
    displayName,
    description,
    color,
    params,
    config,
    dir: name,
    source,
  });

  const existing = await findSkillByName(name);
  if (existing) {
    if (opts?.overwrite) {
      const visibility = normalizeVisibility(opts.visibility);
      try {
        if (visibility) {
          // 覆盖更新：visibility 同步改写；owner_id 保持原创建人不变
          await dbExec(
            `UPDATE skills SET type = ?, description = ?, config = ?, source = ?, visibility = ?, updated_at = ?
             WHERE id = ?`,
            [type, description, configJson, source, visibility, now, existing.id]
          );
        } else {
          await dbExec(
            `UPDATE skills SET type = ?, description = ?, config = ?, source = ?, updated_at = ?
             WHERE id = ?`,
            [type, description, configJson, source, now, existing.id]
          );
        }
      } catch (e) {
        if (isBadFieldError(e) && !visibility) {
          return dbErrorResult(`覆盖技能「${name}」失败：${(e as Error).message}`);
        }
        if (isBadFieldError(e)) {
          // 旧库缺 visibility 列：降级为不带可见性的 UPDATE（覆盖对象已存在，默认 public 语义不变）
          try {
            await dbExec(
              `UPDATE skills SET type = ?, description = ?, config = ?, source = ?, updated_at = ?
               WHERE id = ?`,
              [type, description, configJson, source, now, existing.id]
            );
          } catch (e2) {
            return dbErrorResult(`覆盖技能「${name}」失败：${(e2 as Error).message}`);
          }
        } else {
          return dbErrorResult(`覆盖技能「${name}」失败：${(e as Error).message}`);
        }
      }
      return { ok: true, id: existing.id, created: false, message: `已覆盖更新技能「${name}」` };
    }
    return {
      ok: false,
      status: "duplicate",
      message: `技能「${name}」已存在`,
      existing: { id: existing.id, name, source: existing.source },
    };
  }

  const visibility = normalizeVisibility(opts?.visibility) ?? VISIBILITY_PUBLIC;
  const ownerId = typeof opts?.ownerId === "number" && Number.isInteger(opts.ownerId) ? opts.ownerId : null;

  const insertSkill = async (): Promise<number> => {
    const info = await dbExec(
      `INSERT INTO skills (name, type, description, config, source, visibility, owner_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [name, type, description, configJson, source, visibility, ownerId, now, now]
    );
    return info.insertId;
  };

  /** 旧库兜底 INSERT：不写可见性两列（列默认 public/NULL）；仅 visibility=public 时允许（personal 缺列会泄露隐私，必须报错） */
  const insertSkillLegacy = async (): Promise<number> => {
    const info = await dbExec(
      `INSERT INTO skills (name, type, description, config, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [name, type, description, configJson, source, now, now]
    );
    return info.insertId;
  };

  let insertId: number;
  try {
    insertId = await insertSkill();
  } catch (e) {
    if (isBadFieldError(e)) {
      // 旧库缺列：先尝试自愈补列（source 与 visibility 两代迁移都兜底），
      // 仍缺列时仅 public 语义降级旧 INSERT（personal 必须报错，防隐私泄露）
      await ensureSourceColumns();
      const ensured = await ensureVisibilityColumns();
      if (ensured) {
        try {
          insertId = await insertSkill();
        } catch (e2) {
          if (isDuplicateKeyError(e2)) {
            const ex = await findSkillByName(name);
            return {
              ok: false,
              status: "duplicate",
              message: `技能「${name}」已存在`,
              existing: ex ?? { id: 0, name },
            };
          }
          return dbErrorResult(`保存技能「${name}」失败：${(e2 as Error).message}`);
        }
      } else if (visibility === VISIBILITY_PUBLIC) {
        try {
          insertId = await insertSkillLegacy();
        } catch (e2) {
          if (isDuplicateKeyError(e2)) {
            const ex = await findSkillByName(name);
            return {
              ok: false,
              status: "duplicate",
              message: `技能「${name}」已存在`,
              existing: ex ?? { id: 0, name },
            };
          }
          return dbErrorResult(`保存技能「${name}」失败：${(e2 as Error).message}`);
        }
      } else {
        return dbErrorResult(
          "库结构未升级：skills 表缺少 visibility/owner_id 列且自动补列失败，请先启动一次管理后台完成迁移"
        );
      }
    } else if (isDuplicateKeyError(e)) {
      const ex = await findSkillByName(name);
      return {
        ok: false,
        status: "duplicate",
        message: `技能「${name}」已存在`,
        existing: ex ?? { id: 0, name },
      };
    } else {
      return dbErrorResult(`保存技能「${name}」失败：${(e as Error).message}`);
    }
  }
  return { ok: true, id: insertId, created: true, message: `技能「${name}」已保存到技能中心` };
}

/**
 * 执行技能：按类型分发（shell / prompt / http），全程写入 skill_runs。
 * shell 在应用进程内以子进程执行（Docker 部署时天然隔离在容器内）。
 */
export async function runSkill(
  skillId: number,
  input: Record<string, unknown>,
  triggeredBy: string
): Promise<RunResult> {
  const rowData = await row<{ id: number; name: string; type: SkillType; config: string }>(
    "SELECT id, name, type, config FROM skills WHERE id = ?",
    [skillId]
  );
  if (!rowData) throw new Error("技能不存在");

  let c: { params?: SkillParam[]; config: SkillConfig; dir?: string };
  try {
    c = JSON.parse(rowData.config) as typeof c;
  } catch {
    c = { config: {} };
  }

  const params: Record<string, string> = {};
  for (const p of c.params || []) {
    const v = input?.[p.name];
    params[p.name] = v === undefined || v === null ? p.default ?? "" : String(v);
  }
  for (const p of c.params || []) {
    if (p.required && !params[p.name].trim()) {
      throw new Error(`参数「${p.label || p.name}」为必填项`);
    }
  }

  const info = await dbExec(
    "INSERT INTO skill_runs (skill_id, status, input, triggered_by) VALUES (?, 'running', ?, ?)",
    [rowData.id, JSON.stringify(params), triggeredBy]
  );
  const runId = info.insertId;

  const started = Date.now();
  let status: "success" | "failed" = "success";
  let output = "";
  let error = "";

  try {
    const r = await execSkillBody(rowData, c, params);
    output = r.output;
    error = r.error;
    if (error) status = "failed";
  } catch (e) {
    status = "failed";
    error = (e as Error).message || String(e);
  }

  const durationMs = Date.now() - started;
  await dbExec(
    "UPDATE skill_runs SET status = ?, output = ?, error = ?, finished_at = NOW(), duration_ms = ? WHERE id = ?",
    [status, output, error, durationMs, runId]
  );
  await dbExec("UPDATE skills SET last_run_at = NOW() WHERE id = ?", [rowData.id]);

  return { runId, status, output, error, durationMs };
}

/** 技能体执行（shell / prompt / http），按类型分发。 */
async function execSkillBody(
  rowData: { id: number; name: string; type: SkillType },
  c: { params?: SkillParam[]; config: SkillConfig; dir?: string },
  params: Record<string, string>
): Promise<{ output: string; error: string }> {
  if (rowData.type === "shell" && c.config.shell) {
    const command = renderTemplate(c.config.shell.command, params);
    // AI 产物只落 DB 不落盘：skills/<name> 目录可能不存在（ENOENT），回退到 skills 根目录执行
    const skillDir = path.join(SKILLS_DIR, c.dir || rowData.name);
    const cwd = fs.existsSync(skillDir) ? skillDir : SKILLS_DIR;
    return runShell({
      command,
      timeoutSec: c.config.shell.timeout,
      cwd,
    });
  }

  if (rowData.type === "prompt" && c.config.prompt) {
    return {
      output:
        renderTemplate(c.config.prompt.template, params).trim() +
        "\n\n---\n提示词已渲染完成。接入 AI 自动成文将在后续版本提供。",
      error: "",
    };
  }

  if (rowData.type === "http" && c.config.http) {
    const h = c.config.http;
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(h.headers || {})) {
      headers[k] = renderTemplate(v, params);
    }
    return runHttp({
      method: h.method,
      url: renderTemplate(h.url, params),
      headers,
      body: h.body ? renderTemplate(h.body, params) : undefined,
      timeoutSec: h.timeout,
    });
  }

  return { output: "", error: "技能配置缺失或不完整" };
}
