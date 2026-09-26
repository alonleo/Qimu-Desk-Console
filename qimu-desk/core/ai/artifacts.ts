/**
 * AI 产物结构化契约与写通道编排。
 *
 * - 类型：ChatDraft / SkillDraft / WorkflowDraft / KnowledgeDraft / SaveResult / SourceValue；
 * - zod 宽松校验（§3.3）：name/slug/枚举等做轻量把关，params/config/steps 深校验交给对应写入器
 *   （core/skills.ts createSkill、core/workflows.ts createWorkflow），避免双份漂移；
 * - extractArtifacts：解析模型正文里的 <artifacts> 块 / ```json 围栏；
 * - normalizeDraft：逐条 safeParse + 生成 issues；
 * - writeArtifact：按 kind 调 createSkill / createWorkflow / createDoc，供显式保存调用。
 *
 * 依赖方向说明：本模块值依赖 core/skills、core/workflows、core/knowledge；
 * 这三个 core 模块对 artifacts 只做 `import type`（编译期擦除），故无运行时循环依赖。
 */
import { z } from "zod";
import { createSkill, coerceSkillConfig } from "../skills";
import { createWorkflow } from "../workflows";
import { createDoc } from "../knowledge";
import type { SkillConfig, SkillParam, SkillType } from "../skills";
import type { WorkflowStep } from "../workflows";

/** 来源标识：manual=手动 file=文件播种 ai=AI 生成（未知/admin 一律归一化为 manual） */
export type SourceValue = "manual" | "file" | "ai";

/** 可入库的 AI 产物类型 */
export type ArtifactKind = "skill" | "workflow" | "knowledge";

/**
 * 写入器统一返回：调用方（写路由 / writeArtifact）据此分支处理。
 * - ok:true 且 created:true  → 新建成功；
 * - ok:true 且 created:false → overwrite 覆盖成功；
 * - ok:false status=duplicate → 同名冲突，可带 existing 供前端「覆盖/另存/放弃」；
 * - ok:false status=invalid   → 校验失败（人话错误文案）；
 * - ok:false status=error     → 运行期/数据库错误。
 */
export type SaveResult =
  | { ok: true; id: number; created: true; message: string }
  | { ok: true; id: number; created: false; message: string }
  | {
      ok: false;
      status: "duplicate" | "invalid" | "error";
      message: string;
      existing?: { id: number; name: string; source?: SourceValue | string };
    };

/** 技能草稿（宽松形态：params/config 由 createSkill 深校验清洗） */
export type SkillDraft = {
  name: string;
  type: SkillType;
  displayName?: string;
  description?: string;
  color?: string;
  params?: SkillParam[];
  config?: SkillConfig;
};

/** 工作流草稿（宽松形态：params/steps 由 createWorkflow 深校验清洗） */
export type WorkflowDraft = {
  name: string;
  displayName?: string;
  description?: string;
  color?: string;
  params?: SkillParam[];
  steps: WorkflowStep[];
};

/** 知识文档草稿 */
export type KnowledgeDraft = {
  title: string;
  category?: string;
  tags?: string[];
  content?: string;
};

/** 一次解析得到的单条草稿（key 由 extractArtifacts 分配 draft-${i}，供前端列表稳定） */
export type ChatDraft = {
  key: string;
  kind: ArtifactKind;
  payload: SkillDraft | WorkflowDraft | KnowledgeDraft;
  /** normalize 未全通过时的人话提示（可编辑再保存），非阻断 */
  issues?: string[];
};

/** 模型原文解析结果 */
export type ExtractResult = {
  /** 清洗后的回复正文（已剔除 <artifacts>/```json 区段） */
  reply: string;
  drafts: ChatDraft[];
  /** 被丢弃项的人话原因（解析不合法/结构不完整） */
  skipped: string[];
};

/** writeArtifact 选项：source 一般固定 'ai'；username 供知识文档记录创建者 */
export type WriteOptions = {
  source?: SourceValue;
  overwrite?: boolean;
  username?: string;
};

// —— zod schema（宽松收下结构，深校验交写入器） ——

const skillPayloadSchema = z.object({
  name: z.string().trim().regex(/^[a-z0-9][a-z0-9-]*$/, "name 需为小写字母/数字开头，可含数字、连字符"),
  type: z.enum(["shell", "prompt", "http"]),
  displayName: z.string().optional(),
  description: z.string().optional(),
  color: z.string().optional(),
  params: z.array(z.record(z.string(), z.unknown())).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

const workflowPayloadSchema = z.object({
  name: z.string().trim().regex(/^[a-z0-9][a-z0-9-]*$/, "name 需为小写字母/数字开头，可含数字、连字符"),
  displayName: z.string().optional(),
  description: z.string().optional(),
  color: z.string().optional(),
  params: z.array(z.record(z.string(), z.unknown())).optional(),
  steps: z.array(z.record(z.string(), z.unknown())).min(1, "steps 不能为空"),
});

const knowledgePayloadSchema = z.object({
  title: z.string().trim().min(1, "标题不能为空").max(200, "标题过长"),
  category: z.string().max(30).optional(),
  tags: z.array(z.string()).max(10).optional(),
  content: z.string().optional(),
});

const artifactSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("skill"), payload: skillPayloadSchema }),
  z.object({ kind: z.literal("workflow"), payload: workflowPayloadSchema }),
  z.object({ kind: z.literal("knowledge"), payload: knowledgePayloadSchema }),
]);

// —— 解析 ——

/** 剥掉 ```json 围栏后尝试 JSON.parse；成功且为数组才返回 */
function parseArtifactList(text: string): unknown[] | null {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  if (!cleaned) return null;
  try {
    const v: unknown = JSON.parse(cleaned);
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/** 在原文中找最后一个 ```json / ``` 代码块 */
function lastFenceBlock(content: string): { start: number; end: number; text: string } | null {
  const re = /```(?:json)?\s*([\s\S]*?)```/gi;
  let last: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) last = m;
  if (!last || last.index < 0) return null;
  return { start: last.index, end: last.index + last[0].length, text: last[1] };
}

/** 逐条归一化产物数组，返回 drafts（已分配 key）与 skipped（人话原因） */
function collectDrafts(list: unknown[]): { drafts: ChatDraft[]; skipped: string[] } {
  const drafts: ChatDraft[] = [];
  const skipped: string[] = [];
  for (const item of list) {
    const r = normalizeDraft(item);
    if ("draft" in r && r.draft) {
      r.draft.key = `draft-${drafts.length}`;
      drafts.push(r.draft);
    } else {
      skipped.push("skipped" in r ? r.skipped : "无法解析的草稿");
    }
  }
  return { drafts, skipped };
}

/**
 * 从模型正文中提取草稿（§3.2）。
 * - 标准路径：取最后一个 <artifacts>…</artifacts>，解析为数组；全丢时回复追加人话说明；
 * - 容错回退：无 <artifacts> 时，仅当 ```json 围栏解析为「合法产物数组」
 *   （至少一项能通过 normalizeDraft）才消费该围栏并剥离为 reply；
 * - 纯问答正文里的普通 ```json 代码示例（对象/非产物数组）一律保持 reply=原文，
 *   不截断、drafts=[], skipped=[]（P0 纯问答无回归）。
 */
export function extractArtifacts(content: string): ExtractResult {
  // 先移除推理区，再解析产物；思考中的协议示例不是用户可保存的草稿。
  const src = (typeof content === "string" ? content : "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<think>[\s\S]*$/gi, "");
  const tagStart = src.lastIndexOf("<artifacts>");
  const tagEndRel = tagStart >= 0 ? src.indexOf("</artifacts>", tagStart) : -1;

  // ① 标准路径：存在 <artifacts> 标签
  if (tagStart >= 0 && tagEndRel > tagStart) {
    const inner = src.slice(tagStart + "<artifacts>".length, tagEndRel);
    const list = parseArtifactList(inner);
    const reply = (src.slice(0, tagStart) + src.slice(tagEndRel + "</artifacts>".length)).trim();
    if (!list) return { reply: src.trim(), drafts: [], skipped: [] };
    const { drafts, skipped } = collectDrafts(list);
    // 有产物意图但全部项被丢弃时，在回复里给出人话说明（§3.2 回落纯文本）
    if (drafts.length === 0 && skipped.length > 0) {
      return {
        reply: reply
          ? `${reply}\n\n（未能生成结构化产物：${skipped.join("；")}）`
          : "未能生成结构化产物。",
        drafts,
        skipped,
      };
    }
    return { reply, drafts, skipped };
  }

  // ② 容错回退：无 <artifacts> 标签时，只有确认是产物数组才消费围栏
  const fence = lastFenceBlock(src);
  if (fence) {
    const list = parseArtifactList(fence.text);
    if (list) {
      const { drafts, skipped } = collectDrafts(list);
      if (drafts.length > 0) {
        const reply = (src.slice(0, fence.start) + src.slice(fence.end)).trim();
        return { reply, drafts, skipped };
      }
    }
  }

  // ③ 纯问答 / 非产物代码块：原文完整返回，不截断、不产 drafts、不产生噪音
  return { reply: src.trim(), drafts: [], skipped: [] };
}

/**
 * 逐条归一化：safeParse + 去未知键 + 轻量 issues（深校验仍由写入器负责）。
 * 失败返回 { skipped }（人话原因，调用方累计给用户）。
 */
export function normalizeDraft(raw: unknown): { draft?: ChatDraft } | { skipped: string } {
  const parsed = artifactSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path?.length ? `字段「${issue.path.join(".")}」` : "";
    return { skipped: `结构不完整：${where}${issue?.message ?? "无法解析"}` };
  }
  const data = parsed.data;
  const payload = data.payload as SkillDraft | WorkflowDraft | KnowledgeDraft;

  // 轻量 issues：不阻断展示/保存，仅提示用户在保存前核对
  const issues: string[] = [];
  if (data.kind === "skill") {
    const p = payload as SkillDraft;
    // 容错：把平铺在 config 顶层的 url/method 等搬进 config.http，再判断必填项
    p.config = coerceSkillConfig(p.type, p.config ?? {}) as SkillConfig;
    const cfg = p.config ?? {};
    if (p.type === "http" && !String((cfg.http as { url?: unknown } | undefined)?.url ?? "").trim()) {
      issues.push("http 技能缺少 http.url，建议编辑补全后保存");
    } else if (p.type === "shell" && !String((cfg.shell as { command?: unknown } | undefined)?.command ?? "").trim()) {
      issues.push("shell 技能缺少 shell.command，建议编辑补全后保存");
    }
  } else if (data.kind === "knowledge") {
    const p = payload as KnowledgeDraft;
    if (!p.content?.trim()) issues.push("正文为空，可在编辑后补充");
  }

  const draft: ChatDraft = {
    key: "",
    kind: data.kind,
    payload,
    issues: issues.length ? issues : undefined,
  };
  return { draft };
}

// —— 写通道编排 ——

/**
 * 按 kind 执行显式保存：
 * - skill/workflow 深校验 + 重名/overwrite 语义在 createSkill/createWorkflow 内；
 * - knowledge 经 createDoc 落库，username 用于 created_by；
 * - source 默认 'ai'（AI 产物入库标记）。
 */
export async function writeArtifact(
  kind: ArtifactKind,
  payload: SkillDraft | WorkflowDraft | KnowledgeDraft,
  opts?: WriteOptions
): Promise<SaveResult> {
  const source = opts?.source ?? "ai";
  if (kind === "skill") {
    const p = payload as SkillDraft;
    return createSkill(
      {
        name: p.name,
        type: p.type,
        displayName: p.displayName,
        description: p.description,
        color: p.color,
        params: Array.isArray(p.params) ? (p.params as SkillParam[]) : undefined,
        config: (p.config ?? {}) as SkillConfig,
      },
      { source, overwrite: opts?.overwrite }
    );
  }
  if (kind === "workflow") {
    const p = payload as WorkflowDraft;
    return createWorkflow(
      {
        name: p.name,
        displayName: p.displayName,
        description: p.description,
        color: p.color,
        params: Array.isArray(p.params) ? (p.params as SkillParam[]) : undefined,
        steps: Array.isArray(p.steps) ? (p.steps as WorkflowStep[]) : [],
      },
      { source, overwrite: opts?.overwrite }
    );
  }
  const p = payload as KnowledgeDraft;
  const doc = await createDoc(
    {
      title: p.title,
      category: p.category?.trim() || "未分类",
      tags: Array.isArray(p.tags)
        ? p.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 10)
        : [],
      content: typeof p.content === "string" ? p.content : "",
    },
    opts?.username || "ai",
    { source }
  );
  return { ok: true, id: doc.id, created: true, message: `知识文档「${doc.title}」已保存到知识库` };
}
