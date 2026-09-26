import Ajv from "ajv";
import Ajv2020 from "ajv/dist/2020";
import { aiReady, completionsUrl, generationOptions, assertInputBudget, type AiConfig, type ChatMessage } from "@/core/llm";
import { getCapability } from "./capabilities";
import { connectMcp, listMcpTools } from "./mcp";
import { getSkillDetail, runSkill } from "@/core/skills";
import { canReadRow } from "@/core/visibility";
import type { User } from "@/core/auth";
import type { ToolRun } from "./capability-schema";

type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
type ModelMessage = { role: string; content: string | null; tool_calls?: ToolCall[]; tool_call_id?: string; reasoning_content?: string; reasoning_details?: unknown[] };
export type ChatTool = {
  name: string; label: string; description: string; parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<{ output: string; error?: boolean }>;
};

export async function prepareCapabilities(opts: {
  user: User; ids: number[]; skillIds: number[]; allowTools: boolean; signal: AbortSignal;
}) {
  const tools: ChatTool[] = [];
  const instructions: string[] = [];
  const closers: (() => Promise<void>)[] = [];
  const close = async () => { await Promise.allSettled(closers.map((fn) => fn())); };
  try {
    for (const id of [...new Set(opts.ids)]) {
      opts.signal.throwIfAborted();
      const capability = await getCapability(opts.user.id, id);
      if (!capability || !capability.enabled) throw new Error(`所选能力 #${id} 不存在或已停用，请重新选择`);
      for (const skill of capability.config.skills) instructions.push(`## Skill: ${skill.name}\n${skill.instructions}`);
      if (!opts.allowTools) continue;
      for (const [serverIndex, server] of capability.config.mcpServers.entries()) {
        const session = await connectMcp(server, opts.signal);
        closers.push(session.close);
        const discovered = await listMcpTools(session.client, opts.signal);
        for (const [index, tool] of discovered.entries()) {
          tools.push({
            name: `mcp_${id}_${serverIndex}_${index}`, label: `${server.name} / ${tool.name}`,
            description: `${server.name}: ${tool.description || tool.name}`.slice(0, 1500),
            parameters: tool.inputSchema,
            execute: async (args) => {
              const result = await session.client.callTool({ name: tool.name, arguments: args }, undefined, { signal: opts.signal, timeout: 30000 });
              // Only return textual/structured results; never inline unbounded binary media.
              const blocks = Array.isArray(result.content) ? result.content : [];
              const text = blocks.map((block) => {
                const b = block as Record<string, unknown>;
                return b.type === "text" && typeof b.text === "string" ? b.text : `[${String(b.type || "resource")}]`;
              }).join("\n");
              let output = text || JSON.stringify(result.structuredContent ?? result);
              for (const secret of Object.values(server.headers)) {
                if (secret) output = output.split(secret).join("[已隐藏凭据]");
              }
              return { output: output.slice(0, 16000), error: result.isError === true };
            },
          });
        }
      }
    }
    if (opts.allowTools) for (const id of [...new Set(opts.skillIds)]) {
      const detail = await getSkillDetail(id);
      if (!detail || !canReadRow(opts.user, detail.skill)) throw new Error(`所选技能 #${id} 不可用`);
      const skill = detail.skill;
      const properties = Object.fromEntries(skill.params.map((p) => [p.name, { type: "string", description: p.description || p.label || p.name }]));
      tools.push({
        name: `skill_${id}`, label: `技能 / ${skill.displayName}`, description: skill.description || skill.displayName,
        parameters: { type: "object", properties, required: skill.params.filter((p) => p.required && !p.default).map((p) => p.name), additionalProperties: false },
        execute: async (args) => {
          opts.signal.throwIfAborted();
          // Recheck access immediately before invoking a potentially mutating skill.
          const current = await getSkillDetail(id);
          if (!current || !canReadRow(opts.user, current.skill)) throw new Error("技能不可用");
          const result = await runSkill(id, args, opts.user.username);
          return { output: [result.output, result.error].filter(Boolean).join("\n").slice(0, 16000), error: result.status !== "success" };
        },
      });
    }
    if (tools.length > 64) throw new Error("所选工具超过 64 个，请减少本次使用的 MCP 服务");
    if (instructions.join("\n").length > 100000) throw new Error("所选 Skill 指令总长度过大，请减少本次使用的 Skill");
    return { tools, instructions, close };
  } catch (error) { await close(); throw error; }
}

/** OpenAI-compatible function calling. Serial execution, bounded rounds, no automatic request replay. */
export async function chatWithTools(opts: {
  cfg: AiConfig; messages: ChatMessage[]; tools: ChatTool[]; signal: AbortSignal;
  onTool: (run: ToolRun) => void;
}): Promise<{ content: string; toolRuns: ToolRun[] }> {
  if (!aiReady(opts.cfg)) throw new Error("当前 AI 网关未配置或未启用");
  const messages: ModelMessage[] = [...opts.messages];
  const registry = new Map(opts.tools.map((tool) => {
    // Per-tool validators avoid schema $id collisions between unrelated MCP services
    // and avoid retaining user-provided schemas in a process-global cache.
    const Validator = String(tool.parameters.$schema || "").includes("draft-07") ? Ajv : Ajv2020;
    const validator = new Validator({ strict: false, allErrors: false, validateFormats: false });
    return [tool.name, { tool, validate: validator.compile(tool.parameters) }];
  }));
  const runs: ToolRun[] = [];
  const callIds = new Set<string>();
  for (let round = 0; round < 7; round++) {
    opts.signal.throwIfAborted();
    assertInputBudget(opts.cfg, { messages, tools: opts.tools.map(t => ({ name: t.name, description: t.description, parameters: t.parameters })) });
    const response = await fetch(completionsUrl(opts.cfg.base_url), {
      method: "POST", signal: opts.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${opts.cfg.api_key}` },
      body: JSON.stringify({
        model: opts.cfg.model, messages, temperature: opts.cfg.temperature, ...generationOptions(opts.cfg, 4000), stream: false,
        ...(opts.tools.length ? {
          tools: opts.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })),
          tool_choice: round === 6 || runs.length >= 12 ? "none" : "auto",
        } : {}),
      }),
    });
    if (!response.ok) throw new Error(`AI 网关返回 HTTP ${response.status}；请确认所选模型支持工具调用`);
    const data = await response.json() as { error?: { message?: string }; choices?: { message?: ModelMessage; finish_reason?: string }[] };
    if (data.error) throw new Error("AI 网关拒绝了工具调用请求，请检查模型配置");
    if (data.choices?.[0]?.finish_reason === "length") throw new Error("模型输出达到长度上限，本轮工具请求未执行，请缩小任务范围后重试");
    const answer = data.choices?.[0]?.message;
    if (!answer) throw new Error("AI 网关未返回回复");
    const calls = answer.tool_calls;
    if (!calls?.length) {
      if (typeof answer.content !== "string" || !answer.content.trim()) throw new Error("AI 网关返回空回复");
      return { content: answer.content, toolRuns: runs };
    }
    if (!Array.isArray(calls) || round === 6 || runs.length + calls.length > 12) throw new Error("已达到本次工具调用上限，请拆分任务后重试");
    messages.push({ role: "assistant", content: typeof answer.content === "string" ? answer.content : null, tool_calls: calls,
      ...(typeof answer.reasoning_content === "string" ? { reasoning_content: answer.reasoning_content } : {}),
      ...(Array.isArray(answer.reasoning_details) ? { reasoning_details: answer.reasoning_details } : {}),
    });
    for (const call of calls) {
      opts.signal.throwIfAborted();
      if (!call || call.type !== "function" || typeof call.id !== "string" || !call.id || callIds.has(call.id) || typeof call.function?.name !== "string") throw new Error("模型返回了无效或重复的工具调用");
      callIds.add(call.id);
      const entry = registry.get(call.function.name);
      const run: ToolRun = { id: call.id, name: entry?.tool.label || call.function.name, status: "running" };
      opts.onTool(run);
      let output: string; let failed = false;
      try {
        if (!entry) throw new Error("工具未授权或不存在");
        if (typeof call.function.arguments !== "string" || call.function.arguments.length > 20000) throw new Error("工具参数无效或过大");
        const args: unknown = JSON.parse(call.function.arguments);
        if (!args || typeof args !== "object" || Array.isArray(args) || !entry.validate(args)) throw new Error("工具参数不符合输入要求");
        const result = await entry.tool.execute(args as Record<string, unknown>);
        output = result.output.slice(0, 16000); failed = !!result.error;
      } catch (error) {
        opts.signal.throwIfAborted();
        failed = true;
        // Network errors may contain URLs/credentials; keep details out of model and history.
        output = error instanceof SyntaxError ? "工具参数不是有效 JSON" : "工具调用失败：请检查参数、连接状态及访问权限";
      }
      opts.signal.throwIfAborted();
      const finished: ToolRun = { ...run, status: failed ? "error" : "success", output: output.slice(0, 3000) };
      runs.push(finished); opts.onTool(finished);
      messages.push({ role: "tool", tool_call_id: call.id, content: output });
    }
  }
  throw new Error("工具调用次数超出限制");
}
