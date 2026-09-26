/**
 * AI 对话 P2 增强：快捷指令解析 / 产物模板 / 单类型约束提示。
 *
 * - P2-1 快捷指令：/create-skill <描述>、/create-workflow <描述>、/create-doc <描述>
 *   （兼容 /create-knowledge 别名）。命中后服务端注入「只产出该 kind」约束并过滤跑偏草稿。
 * - P2-2 产物模板：前端输入框上方快捷项点击后预填模板文案（用户补全后发送）。
 * - 本模块纯常量/纯函数，无副作用，可被 chat route 与客户端组件共同引用。
 */

export type QuickKind = "skill" | "workflow" | "knowledge";

export type QuickCommand = {
  kind: QuickKind;
  /** 指令后剩余的原始描述（可为空串） */
  rest: string;
};

export const QUICK_KIND_LABEL: Record<QuickKind, string> = {
  skill: "技能",
  workflow: "工作流",
  knowledge: "知识",
};

const COMMAND_ALIASES: Array<{ kind: QuickKind; aliases: string[] }> = [
  { kind: "skill", aliases: ["/create-skill"] },
  { kind: "workflow", aliases: ["/create-workflow"] },
  { kind: "knowledge", aliases: ["/create-doc", "/create-knowledge"] },
];

/** 解析一条消息文本；仅当以快捷指令开头时返回命令，否则返回 null（普通聊天/其他内容）。 */
export function parseQuickCommand(text: string): QuickCommand | null {
  const trimmed = (text || "").trim();
  if (!trimmed.startsWith("/")) return null;
  for (const { kind, aliases } of COMMAND_ALIASES) {
    for (const alias of aliases) {
      // /create-skill  或  /create-skill 描述
      if (trimmed === alias) return { kind, rest: "" };
      if (trimmed.startsWith(alias + " ")) {
        return { kind, rest: trimmed.slice(alias.length).trim() };
      }
    }
  }
  return null;
}

/** 快捷指令命中后注入的 system 约束（放在 ARTIFACT_SYSTEM_PROMPT 之后）。 */
export function quickSystemHint(cmd: QuickCommand): string {
  const label = QUICK_KIND_LABEL[cmd.kind];
  const hint =
    cmd.rest.length > 0
      ? `用户本次明确要求创建${label}，需求描述：${cmd.rest}`
      : `用户本次明确要求创建${label}，但未给出具体描述`;
  return `请注意：${hint}。
请只产出 kind=${JSON.stringify(cmd.kind)} 的草稿（至多 1 个），不要输出其他类型。
若信息不足以生成高质量草稿，请在正文中用提问方式向用户收集必要信息（如技能类型/命令/URL、工作流步骤、文档主题），不要编造关键配置。
若产出 http 类型技能或工作流步骤：config.http.url / 步骤 url 为硬性必填，必须是非空完整请求地址（动态部分用 {{参数名}} 占位拼进 url），禁止只给 method 不给 url。`;
}

/**
 * 自然语言关键词意图识别（P3）：不走 /create-* 指令，直接从普通对话里识别创建意图。
 * 命中条件：消息中同时出现「该类型的名词关键词」与「创建意图动词」，避免
 * 「技能中心在哪」「看看我的工作流列表」这类查询被误判为创建请求。
 * 英文关键词按整词匹配（防止 docker 误命中 doc 等子串）。
 */
const KIND_KEYWORDS: Array<{ kind: QuickKind; words: string[] }> = [
  { kind: "skill", words: ["技能", "skill"] },
  { kind: "workflow", words: ["工作流", "workflow"] },
  { kind: "knowledge", words: ["知识文档", "知识", "文档", "doc", "document"] },
];

const CREATE_VERBS = [
  "创建", "新建", "生成", "写一个", "做一个", "做一份", "做一套", "搞一个",
  "帮我写", "帮我做", "帮我搞", "帮我建", "编写", "编排", "整理成", "产出",
  "create", "make", "build", "generate", "write",
];

function hasEnglishWord(text: string, word: string): boolean {
  return new RegExp(`\\b${word}\\b`, "i").test(text);
}

export function parseQuickIntent(text: string): QuickCommand | null {
  const raw = (text || "").trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  for (const { kind, words } of KIND_KEYWORDS) {
    const hitNoun = words.some((w) =>
      /^[a-z]/i.test(w) ? hasEnglishWord(lower, w) : lower.includes(w)
    );
    if (!hitNoun) continue;
    const hitVerb = CREATE_VERBS.some((v) =>
      /^[a-z]/i.test(v) ? hasEnglishWord(lower, v) : lower.includes(v)
    );
    if (hitVerb) return { kind, rest: raw };
  }
  return null;
}

/**
 * 产物模板（P2-2）：点击快捷项后在输入框预填骨架，用户补全后发送。
 * prompt 以对应 /create-* 指令开头，发送即走快捷指令通道。
 */
export type QuickTemplate = {
  key: QuickKind;
  label: string;
  desc: string;
  prompt: string;
};

export const QUICK_TEMPLATES: QuickTemplate[] = [
  {
    key: "skill",
    label: "技能",
    desc: "让 AI 生成 shell / prompt / http 技能草稿",
    prompt:
      "/create-skill 请帮我创建一个技能草稿：\n· 用途：\n· 类型建议（shell / prompt / http）：\n· 关键参数：",
  },
  {
    key: "workflow",
    label: "工作流",
    desc: "让 AI 生成多步骤工作流草稿",
    prompt:
      "/create-workflow 请帮我创建一个工作流草稿：\n· 目标：\n· 建议步骤（可写大致的先后顺序）：",
  },
  {
    key: "knowledge",
    label: "知识文档",
    desc: "把内容整理成可入库的知识文档",
    prompt: "/create-doc 请帮我把以下内容整理成一篇知识文档（含标题/分类建议）：\n",
  },
];

export type RunWorkflowCommand = {
  /** 数字 ID（优先） */
  id?: number;
  /** 或按 name 查找 */
  name?: string;
  /** --key value / --key=value 解析出的参数 */
  params: Record<string, string>;
};

const RUN_VERBS = ["运行", "执行", "跑", "测试", "试运行", "run", "execute", "test", "trigger"];

function extractRunParams(text: string): Record<string, string> {
  const params: Record<string, string> = {};
  const tokens = text.split(/\s+/);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (!t.startsWith("--")) continue;
    const eq = t.indexOf("=");
    if (eq !== -1) {
      params[t.slice(2, eq)] = t.slice(eq + 1);
    } else {
      const key = t.slice(2);
      const next = tokens[i + 1];
      if (next && !next.startsWith("--")) {
        params[key] = next;
        i++;
      } else {
        params[key] = "";
      }
    }
  }
  return params;
}

/** /run-workflow <id|name> [--key value]... */
export function parseRunWorkflowCommand(text: string): RunWorkflowCommand | null {
  const trimmed = (text || "").trim();
  if (!trimmed.startsWith("/run-workflow")) return null;
  const rest = trimmed.slice("/run-workflow".length).trim();
  const params = extractRunParams(rest);
  const target = rest.replace(/--\S+(\s+\S+)?/g, "").trim();
  if (!target) return null;
  const num = target.match(/^(\d+)$/);
  if (num) return { id: Number(num[1]), params };
  return { name: target, params };
}

/**
 * 自然语言：运行/执行/测试/跑 工作流 <id|name> [--key value]
 *
 * id 解析规则（收紧，防止过度劫持）：
 * 仅当数字紧跟在「工作流/workflow」词后（如「运行工作流 17」「run workflow 17」）
 * 或呈「N 号工作流」形态（如「运行 3 号工作流」）时才解析为 id；
 * 「看看这个工作流第3步」「测试一下这个工作流的第 3 步」这类普通提问中的数字
 * 不再被劫持为真实执行目标 —— 解析不到 id/name 时返回 null，走正常对话。
 */
export function parseRunWorkflowIntent(text: string): RunWorkflowCommand | null {
  const raw = (text || "").trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  const hasRunVerb = RUN_VERBS.some((v) =>
    /^[a-z]/i.test(v) ? hasEnglishWord(lower, v) : raw.includes(v)
  );
  const hasNoun = raw.includes("工作流") || hasEnglishWord(lower, "workflow");
  if (!hasRunVerb || !hasNoun) return null;
  const params = extractRunParams(raw);
  // id：数字必须紧跟在工作流/workflow 词后，或「N 号工作流」形态
  const idMatch =
    raw.match(/工作流\s*[:：]?\s*(\d{1,6})(?!\d)/) ||
    raw.match(/workflow\s*[:：]?\s*#?(\d{1,6})(?!\d)/i) ||
    raw.match(/(\d{1,6})\s*号\s*工作流/);
  if (idMatch) return { id: Number(idMatch[1]), params };
  const m =
    raw.match(/工作流\s+([a-z][a-z0-9-]*)/i) ||
    raw.match(/workflow\s+([a-z][a-z0-9-]*)/i);
  if (m) return { name: m[1], params };
  return null;
}
