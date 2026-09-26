import { NextResponse } from "next/server";
import { assertOrigin, jsonError, requireUser, readJson } from "@/core/api";
import {
  chatLlm,
  chatLlmStream,
  getAiConfigById,
  getAiConfig,
  type ChatMessage,
  type AiConfig,
} from "@/core/llm";
import { listDocs } from "@/core/knowledge";
import { aiChatSchema, firstZodError } from "@/core/schemas";
import { extractArtifacts, writeArtifact } from "@/core/ai/artifacts";
import { ARTIFACT_SYSTEM_PROMPT } from "@/core/ai/prompts";
import { parseQuickCommand, parseQuickIntent, quickSystemHint, parseRunWorkflowCommand, parseRunWorkflowIntent, type RunWorkflowCommand } from "@/core/ai/commands";
import { getSkillDetail } from "@/core/skills";
import { getWorkflowDetail, runWorkflow, findWorkflowByName, type WorkflowRunResult } from "@/core/workflows";

/** 去掉 snippet 中的 <em>/</em> 高亮标签，还原纯文本 */
function stripEm(s: string): string {
  return s.replace(/<\/?em>/g, "");
}

type SkillInfo = {
  displayName: string;
  name: string;
  description: string;
  type: string;
  params: unknown[];
  config: unknown;
};

type WorkflowInfo = {
  displayName: string;
  name: string;
  description: string;
  params: unknown[];
  steps: { name: string; id: string; type: string }[];
};

/** 用户消息上的引用元数据（与 core/schemas.ts chatRefMetaSchema 对齐，全部可选除 id） */
type ChatRefMeta = {
  id: number;
  name?: string;
  displayName?: string;
  description?: string;
};

/**
 * 生成单条引用的紧凑摘要行：[引用技能：显示名（标识名）— 一句话描述]
 * 单条一行、整行不超过 200 字符，不含完整 config/params/步骤详情。
 */
function formatRefLine(label: string, ref: ChatRefMeta): string {
  const display = (ref.displayName || ref.name || `#${ref.id}`).slice(0, 50);
  const ident = ref.name && ref.name !== display ? `（${ref.name.slice(0, 50)}）` : "";
  const head = `[引用${label}：${display}${ident}`;
  const tail = "]";
  let line = head + (ref.description ? ` — ${ref.description}` : "") + tail;
  if (line.length > 200) {
    // 超长时截断描述部分，保留名称与标识名完整；
    // room 需扣除分隔符 " — "(3) 与省略号 "…"(1) 共 4 字符
    const room = Math.max(0, 200 - head.length - tail.length - 4);
    const desc = ref.description ? ` — ${ref.description.slice(0, room)}…` : "";
    line = head + desc + tail;
  }
  return line;
}

/** 格式化技能详情为上下文文本 */
function formatSkillContext(skill: SkillInfo): string {
  return `【技能：${skill.displayName || skill.name}】
标识名：${skill.name}
描述：${skill.description || "无"}
类型：${skill.type}
参数：${JSON.stringify(skill.params, null, 2)}
配置：${JSON.stringify(skill.config, null, 2)}`;
}

/** 格式化工作流详情为上下文文本 */
function formatWorkflowContext(workflow: WorkflowInfo): string {
  const stepsText = workflow.steps
    .map((s: { name: string; id: string; type: string }, i: number) => `  ${i + 1}. ${s.name || s.id} (${s.type})`)
    .join("\n");
  return `【工作流：${workflow.displayName || workflow.name}】
标识名：${workflow.name}
描述：${workflow.description || "无"}
参数：${JSON.stringify(workflow.params, null, 2)}
步骤：
${stepsText}`;
}

/**
 * AI 对话接口：登录用户可用。
 * body: {
 *   messages: [{role, content}],
 *   useKnowledge?: boolean,
 *   category?: string,
 *   tag?: string,
 *   gatewayId?: number,   // 不传/找不到则用默认网关
 *   autoSave?: boolean    // true：识别到结构化产物后服务端直接落库，返回 saveResults
 *   stream?: boolean      // true：SSE 流式返回（delta/done/error 事件）；默认 false 返回原 JSON
 *   skillIds?: number[]   // 引用的技能 ID 列表
 *   workflowIds?: number[] // 引用的工作流 ID 列表
 * }
 * useKnowledge 为 true 时，用最后一条用户消息检索知识库 top 3，拼成 RAG 上下文注入 system。
 * system 区末尾统一注入 ARTIFACT_SYSTEM_PROMPT，让模型按要求输出 <artifacts> 草稿。
 */
export async function POST(req: Request) {
  if (!assertOrigin(req)) return jsonError("跨域请求被拒绝", 403);
  const user = await requireUser();
  if (!user) return jsonError("未登录", 401);

  const body = await readJson(req);
  const parsed = aiChatSchema.safeParse(body);
  if (!parsed.success) return jsonError(firstZodError(parsed), 400);
  const { messages, useKnowledge, autoSave, category, tag, gatewayId, stream, skillIds, workflowIds } = parsed.data;
  const sysBlocks: ChatMessage[] = [];
  let usedDocs: { id: number; title: string }[] = [];

  // 处理引用的技能上下文
  const skillContexts: string[] = [];
  if (skillIds && skillIds.length > 0) {
    for (const id of skillIds) {
      const result = await getSkillDetail(id);
      if (result) {
        skillContexts.push(formatSkillContext(result.skill));
      }
    }
    if (skillContexts.length > 0) {
      sysBlocks.push({
        role: "system",
        content: `===== 引用的技能 =====
（使用指令：用户本次提问引用了以下技能，请优先结合这些技能的信息回答；若某技能与当前问题无关，请忽略它并简要说明。）

${skillContexts.join("\n\n")}
====================`,
      });
    }
  }

  // 处理引用的工作流上下文
  const workflowContexts: string[] = [];
  if (workflowIds && workflowIds.length > 0) {
    for (const id of workflowIds) {
      const result = await getWorkflowDetail(id);
      if (result) {
        workflowContexts.push(formatWorkflowContext(result.workflow));
      }
    }
    if (workflowContexts.length > 0) {
      sysBlocks.push({
        role: "system",
        content: `===== 引用的工作流 =====
（使用指令：用户本次提问引用了以下工作流，请优先结合这些工作流的信息回答；若用户想运行某个工作流，可提示其直接发送『运行工作流 <标识名>』。）

${workflowContexts.join("\n\n")}
======================`,
      });
    }
  }

  // —— 引用上下文跨轮持久化 ——
  // 当次引用已由上方 sysBlocks 全量注入；对历史轮次中带引用元数据（usedSkills/usedWorkflows）
  // 的用户消息，在其 content 末尾追加紧凑摘要，使后续轮次重建会话时模型仍能看到
  // "该条消息曾引用过什么"。只影响发给 LLM 的内容，不改入库存储与前端展示。
  const hasCurrentInjection = skillContexts.length > 0 || workflowContexts.length > 0;
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      lastUserIdx = i;
      break;
    }
  }
  const llmMessages: ChatMessage[] = messages.map((m, i) => {
    if (m.role !== "user") return m;
    const lines: string[] = [];
    for (const s of m.usedSkills ?? []) lines.push(formatRefLine("技能", s));
    for (const w of m.usedWorkflows ?? []) lines.push(formatRefLine("工作流", w));
    if (lines.length === 0) return m;
    // 当次引用（最后一条用户消息）已由 sysBlocks 注入完整详情，避免重复追加
    if (hasCurrentInjection && i === lastUserIdx) return m;
    return { ...m, content: `${m.content}\n${lines.join("\n")}` };
  });

  if (useKnowledge) {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const query = lastUser?.content?.trim() || "";
    const hits = query
      ? await listDocs({
          q: query,
          category: category as string | undefined,
          tag: tag as string | undefined,
          limit: 3,
        })
      : [];
    if (hits.length > 0) {
      const context = hits
        .map((d) => `【文档：${d.title}】\n${stripEm(d.excerpt || "").trim()}`)
        .join("\n\n");
      sysBlocks.push({
        role: "system",
        content: `你是工作台知识助手。请优先依据以下知识库资料回答；资料不足时如实说明，不要编造。\n\n===== 知识库资料 =====\n${context}\n===== 资料结束 =====`,
      });
      usedDocs = hits.map((d) => ({ id: d.id, title: d.title }));
    } else {
      sysBlocks.push({
        role: "system",
        content: "你是工作台知识助手。知识库中没有检索到相关资料，请如实说明并基于你的通用知识回答。",
      });
    }
  }

  // 产物结构化提示词固定放 system 区末尾（RAG 上下文之后）
  sysBlocks.push({ role: "system", content: ARTIFACT_SYSTEM_PROMPT });

  // 快捷指令 /create-* 优先；未命中则从自然语言关键词识别创建意图（技能/skill、工作流等）
  const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
  const quickCmd = lastUserMsg
    ? parseQuickCommand(lastUserMsg.content || "") ??
      parseQuickIntent(lastUserMsg.content || "")
    : null;
  if (quickCmd) {
    sysBlocks.push({ role: "system", content: quickSystemHint(quickCmd) });
  }

  // injected 必须在所有 sysBlocks.push 之后构建（数组展开是快照，
  // 提前构建会导致后续注入的 system 块丢失）
  const injected: ChatMessage[] = [...sysBlocks, ...llmMessages];

  // 解析目标网关：优先用户指定的 gatewayId（不要求 enabled，方便临时测试）；找不到则用默认
  let cfg = await getAiConfig();
  if (gatewayId !== undefined && gatewayId > 0) {
    const picked = await getAiConfigById(gatewayId);
    if (picked) cfg = picked;
  }

  // —— 运行工作流指令：/run-workflow <id|name> 或自然语言"运行/测试 工作流 <id>" ——
  // 命中后服务端真正调用 runWorkflow 并返回逐步结果（根治"AI 只说不做"）
  const runCmd =
    lastUserMsg
      ? parseRunWorkflowCommand(lastUserMsg.content || "") ??
        parseRunWorkflowIntent(lastUserMsg.content || "")
      : null;
  if (runCmd) {
    return await handleRunWorkflow({ req, runCmd, user, stream, cfg });
  }

  // —— 流式分支：SSE 事件（delta / done / error） ——
  if (stream) return handleStream({ req, injected, cfg, quickCmd, usedDocs, autoSave, username: user.username });

  // —— 非流式分支（默认，保持兼容；QA/旧客户端走这里） ——
  // 结构化为长输出：maxTokens 提到 4000（见 ARCHITECTURE §3.2）
  const r = await chatLlm({ messages: injected, maxTokens: 4000, cfg });
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error });

  const final = await finalizeContent({ content: r.content, quickCmd, autoSave, usedDocs, cfg, username: user.username });
  if (!final) return NextResponse.json({ ok: false, error: "草稿保存失败" });
  return NextResponse.json(final);
}

/** 抽取草稿（快捷指令收敛 kind）+ 可选自动落库，得到最终返回体 */
async function finalizeContent(opts: {
  content: string;
  quickCmd: { kind: "skill" | "workflow" | "knowledge"; rest: string } | null;
  autoSave?: boolean;
  usedDocs: { id: number; title: string }[];
  cfg: AiConfig;
  username: string;
}) {
  const { content, quickCmd, autoSave, usedDocs, cfg, username } = opts;
  const { reply, drafts: rawDrafts } = extractArtifacts(content);
  const drafts = quickCmd ? rawDrafts.filter((d) => d.kind === quickCmd.kind) : rawDrafts;

  const payload = { ok: true as const, reply, usedDocs, gatewayId: cfg.id };
  if (drafts.length === 0) return payload;

  if (autoSave) {
    const saveResults = [];
    for (const draft of drafts) {
      const res = await writeArtifact(draft.kind, draft.payload, {
        source: "ai",
        username,
      });
      saveResults.push(res);
    }
    // drafts 与 saveResults 按下标对齐：失败项（duplicate/invalid/error）仍保留草稿供手动保存
    return { ...payload, drafts, saveResults };
  }
  return { ...payload, drafts };
}

/** SSE 编码一条事件 */
function sseEvent(obj: unknown): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(obj)}\n\n`);
}

/** 流式分支：以 text/event-stream 返回 delta；结束后回传最终元信息（草稿/保存结果） */
function handleStream(opts: {
  req: Request;
  injected: ChatMessage[];
  cfg: AiConfig;
  quickCmd: { kind: "skill" | "workflow" | "knowledge"; rest: string } | null;
  usedDocs: { id: number; title: string }[];
  autoSave?: boolean;
  username: string;
}): Response {
  const { req, injected, cfg, quickCmd, usedDocs, autoSave, username } = opts;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const push = (obj: unknown) => {
        try {
          controller.enqueue(sseEvent(obj));
        } catch {
          // 客户端已断开：停止推送
        }
      };
      let raw = "";
      const llmRes = await chatLlmStream({
        messages: injected,
        maxTokens: 4000,
        cfg,
        signal: req.signal,
        onDelta: (t) => {
          raw += t;
          push({ type: "delta", text: t });
        },
      });

      if (!llmRes.ok) {
        // 流式中止（用户停止/客户端断开）时：客户端已持有部分文本，不再补发 error；
        // 其它错误（网关报错/超时/空输出）正常下发 error，供客户端降级或提示。
        if (!llmRes.aborted) {
          push({ type: "error", error: llmRes.error });
        }
        try {
          controller.close();
        } catch {
          /* 已关闭 */
        }
        return;
      }

      const final = await finalizeContent({
        content: llmRes.content,
        quickCmd,
        autoSave,
        usedDocs,
        cfg,
        username,
      });
      push({ type: "done", ...final });
      try {
        controller.close();
      } catch {
        /* 已关闭 */
      }
    },
    cancel() {
      // 客户端主动断开：上游 fetch 已绑定 req.signal，无需额外处理
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

/** 把工作流运行结果格式化为可读的 Markdown 文本（作为 chat reply 返回） */
function formatRunResult(result: WorkflowRunResult): string {
  const lines: string[] = [];
  lines.push(`## 工作流运行结果：${result.status === "success" ? "成功 ✅" : "失败 ❌"}`);
  lines.push(`总耗时：${(result.durationMs / 1000).toFixed(2)}s`);
  lines.push("");
  for (const s of result.steps) {
    const icon = s.status === "success" ? "✅" : s.status === "failed" ? "❌" : "⏭️";
    lines.push(`### ${icon} ${s.name || s.stepId}（${s.type}）`);
    if (s.status === "skipped") {
      lines.push("_已跳过（前序步骤失败）_");
      lines.push("");
      continue;
    }
    const out = (s.output || "").trim();
    if (out) {
      const clipped = out.length > 2000 ? out.slice(0, 2000) + "\n…(输出已截断)" : out;
      lines.push("**输出：**");
      lines.push("```");
      lines.push(clipped);
      lines.push("```");
    }
    if (s.error) lines.push(`**错误：** ${s.error}`);
    lines.push(`耗时：${(s.durationMs / 1000).toFixed(2)}s`);
    lines.push("");
  }
  if (result.error) lines.push(`> 整体错误：${result.error}`);
  return lines.join("\n");
}

/** 执行工作流指令：解析目标 → 调用 runWorkflow → 返回结果（支持流式与非流式） */
async function handleRunWorkflow(opts: {
  req: Request;
  runCmd: RunWorkflowCommand;
  user: { username: string };
  stream?: boolean;
  cfg: AiConfig;
}): Promise<Response> {
  const { req, runCmd, user, stream, cfg } = opts;
  let workflowId = runCmd.id;
  if (!workflowId && runCmd.name) {
    const wf = await findWorkflowByName(runCmd.name);
    if (!wf) {
      return NextResponse.json(
        { ok: false, error: `未找到名为「${runCmd.name}」的工作流` },
        { status: 404 }
      );
    }
    workflowId = wf.id;
  }
  if (!workflowId) {
    return NextResponse.json({ ok: false, error: "未指定工作流 ID" }, { status: 400 });
  }
  const proto = req.headers.get("x-forwarded-proto") || "http";
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  const baseUrl = host ? `${proto}://${host}` : undefined;
  let result: WorkflowRunResult;
  try {
    result = await runWorkflow(workflowId, runCmd.params, user.username, baseUrl);
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message || "执行失败" }, { status: 400 });
  }
  const reply = formatRunResult(result);
  const payload = { ok: true, reply, runResult: result, gatewayId: cfg.id, run: true };
  if (stream) {
    const s = new ReadableStream<Uint8Array>({
      async start(controller) {
        const push = (o: unknown) => {
          try {
            controller.enqueue(sseEvent(o));
          } catch {
            /* 客户端已断开 */
          }
        };
        push({ type: "delta", text: reply });
        push({ type: "done", ...payload });
        try {
          controller.close();
        } catch {
          /* 已关闭 */
        }
      },
    });
    return new Response(s, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  }
  return NextResponse.json(payload);
}
