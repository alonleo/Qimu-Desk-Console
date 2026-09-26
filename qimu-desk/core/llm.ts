import { row, rows, exec } from "./db";

/**
 * AI 网关配置（与后端 ai_config 表对齐：多网关，默认网关 is_default=1）。
 * 工作台只读写「默认网关」这一条，避免与后台的多网关管理打架。
 */

export type AiConfig = {
  id: number;
  name: string;
  provider: string;
  base_url: string;
  api_key: string;
  model: string;
  temperature: number;
  max_input_tokens?: number;
  max_output_tokens?: number;
  timeout_seconds?: number;
  enabled: boolean;
  is_default: boolean;
};

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type ChatResult = { ok: true; content: string } | { ok: false; error: string };

/** 流式结果：aborted=true 表示用户主动中止（超时按错误报告），部分内容可能已产出 */
export type ChatStreamResult =
  | { ok: true; content: string }
  | { ok: false; error: string; aborted?: boolean };

type AiConfigRow = {
  id: number;
  name: string;
  provider: string;
  base_url: string;
  api_key: string;
  model: string;
  temperature: number;
  max_input_tokens?: number;
  max_output_tokens?: number;
  timeout_seconds?: number;
  enabled: number;
  is_default: number;
};

function rowToConfig(r: AiConfigRow): AiConfig {
  return {
    id: r.id,
    name: r.name || "默认网关",
    provider: r.provider,
    base_url: r.base_url,
    api_key: r.api_key,
    model: r.model,
    temperature: r.temperature,
    max_input_tokens: Number(r.max_input_tokens || 0),
    max_output_tokens: Number(r.max_output_tokens || 0),
    timeout_seconds: Number(r.timeout_seconds || 0),
    enabled: !!r.enabled,
    is_default: !!r.is_default,
  };
}

/** 取默认网关：优先 is_default=1，其次启用中的最旧一条，再退任意一条；无则 null */
export async function getDefaultRow(): Promise<AiConfigRow | null> {
  const byDefault = await row<AiConfigRow>(
    "SELECT * FROM ai_config WHERE is_default = 1 ORDER BY id LIMIT 1"
  );
  if (byDefault) return byDefault;
  const enabled = await row<AiConfigRow>(
    "SELECT * FROM ai_config WHERE enabled = 1 ORDER BY id LIMIT 1"
  );
  if (enabled) return enabled;
  return row<AiConfigRow>("SELECT * FROM ai_config ORDER BY id LIMIT 1");
}

/** 按 id 取一条网关；若 id 非法/不存在则回退到 getDefaultRow 语义 */
export async function getGatewayRow(id: number | null | undefined): Promise<AiConfigRow | null> {
  if (Number.isInteger(id) && (id as number) > 0) {
    const byId = await row<AiConfigRow>("SELECT * FROM ai_config WHERE id = ?", [id as number]);
    if (byId) return byId;
  }
  return getDefaultRow();
}

/** 按 id 读取一条网关配置（找不到返回 null；不取默认） */
export async function getAiConfigById(id: number): Promise<AiConfig | null> {
  if (!Number.isInteger(id) || id <= 0) return null;
  const r = await row<AiConfigRow>("SELECT * FROM ai_config WHERE id = ?", [id]);
  return r ? rowToConfig(r) : null;
}

/** 读取默认网关配置；无记录时返回空默认配置（is_default 语义占位） */
export async function getAiConfig(): Promise<AiConfig> {
  const r = await getDefaultRow();
  if (!r) {
    return {
      id: 0,
      name: "默认网关",
      provider: "openai-compatible",
      base_url: "",
      api_key: "",
      model: "",
      temperature: 0.7,
      enabled: false,
      is_default: false,
    };
  }
  return rowToConfig(r);
}

/** 保存网关配置：更新默认网关行；不存在则新建为默认网关（id 自增，与后端兼容） */
export async function saveAiConfig(cfg: {
  name?: string;
  provider?: string;
  base_url?: string;
  api_key?: string;
  model?: string;
  temperature?: number;
  max_input_tokens?: number;
  max_output_tokens?: number;
  timeout_seconds?: number;
  enabled?: boolean;
}): Promise<AiConfig> {
  const cur = await getDefaultRow();
  const next = {
    name: cfg.name?.trim() || cur?.name || "默认网关",
    provider: cfg.provider ?? cur?.provider ?? "openai-compatible",
    base_url: (cfg.base_url ?? cur?.base_url ?? "").trim(),
    api_key: (cfg.api_key ?? cur?.api_key ?? "").trim(),
    model: (cfg.model ?? cur?.model ?? "").trim(),
    temperature: cfg.temperature ?? cur?.temperature ?? 0.7,
    enabled: cfg.enabled ?? !!cur?.enabled,
    max_input_tokens: cfg.max_input_tokens ?? cur?.max_input_tokens ?? 0,
    max_output_tokens: cfg.max_output_tokens ?? cur?.max_output_tokens ?? 0,
    timeout_seconds: cfg.timeout_seconds ?? cur?.timeout_seconds ?? 0,
  };

  if (cur) {
    await exec(
      `UPDATE ai_config SET
         name = ?, provider = ?, base_url = ?, api_key = ?, model = ?,
         temperature = ?, max_input_tokens = ?, max_output_tokens = ?, timeout_seconds = ?, enabled = ?, is_default = 1, updated_at = NOW()
       WHERE id = ?`,
      [
        next.name,
        next.provider,
        next.base_url,
        next.api_key,
        next.model,
        next.temperature,
        next.max_input_tokens, next.max_output_tokens, next.timeout_seconds,
        next.enabled ? 1 : 0,
        cur.id,
      ]
    );
    return { ...next, id: cur.id, is_default: true };
  }

  const info = await exec(
    `INSERT INTO ai_config (name, provider, base_url, api_key, model, temperature, max_input_tokens, max_output_tokens, timeout_seconds, enabled, is_default)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [
      next.name,
      next.provider,
      next.base_url,
      next.api_key,
      next.model,
      next.temperature,
      next.max_input_tokens, next.max_output_tokens, next.timeout_seconds,
      next.enabled ? 1 : 0,
    ]
  );
  return { ...next, id: info.insertId, is_default: true };
}

/** 配置是否可用 */
export function aiReady(cfg: AiConfig): boolean {
  return cfg.enabled && !!cfg.base_url && !!cfg.api_key && !!cfg.model;
}

/** 把 base_url 规范化为 chat/completions 地址（兼容 /v1、/v1/、完整地址） */
export function completionsUrl(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, "");
  if (/\/chat\/completions$/i.test(base)) return base;
  return `${base}/chat/completions`;
}

export type GatewayLimits = Pick<AiConfig, "max_input_tokens" | "max_output_tokens" | "timeout_seconds">;

/** 0 为自动；未提交字段保持不变。两端共享相同的取值边界。 */
export function parseGatewayLimits(body: Record<string, unknown>): GatewayLimits {
  const result: GatewayLimits = {};
  const limits = { max_input_tokens: 2_000_000, max_output_tokens: 262_144, timeout_seconds: 600 };
  for (const key of Object.keys(limits) as (keyof typeof limits)[]) {
    if (!(key in body)) continue;
    const value = body[key];
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > limits[key]) {
      throw new Error(`${key} 必须是 0 到 ${limits[key]} 之间的整数（0 表示自动）`);
    }
    result[key] = value;
  }
  return result;
}

/** 本地预算采用保守文本估算，不声称等同于各模型 tokenizer 的精确计数。 */
export function assertInputBudget(cfg: GatewayLimits, input: unknown): void {
  if (!cfg.max_input_tokens) return;
  const text = JSON.stringify(input) || "";
  let ascii = 0, nonAscii = 0;
  for (const char of text) { if (char.codePointAt(0)! < 128) ascii++; else nonAscii++; }
  const estimated = Math.ceil(ascii / 3) + nonAscii * 2;
  if (estimated > cfg.max_input_tokens) throw new Error(`输入上下文预计 ${estimated} tokens，超过此模型设置的 ${cfg.max_input_tokens} 上限。请减少历史消息或引用内容，或在模型设置中提高输入上限。`);
}

/** MiniMax 的生成预算包含推理过程，不能沿用普通模型的短回答额度。
 * reasoning_split 仅分离思考与正文，不关闭思考；其他兼容网关保持原参数。
 */
export function generationOptions(cfg: Pick<AiConfig, "model" | "max_output_tokens">, maxTokens?: number) {
  const minimax = /(?:^|\/)minimax[- ]m[23](?:[.\s-]|$)/i.test(cfg.model);
  const output = cfg.max_output_tokens || (minimax ? Math.max(maxTokens || 0, 16384) : maxTokens);
  return {
    ...(minimax ? { reasoning_split: true } : {}),
    ...(output ? { max_tokens: output } : {}),
  };
}

export function generationTimeout(cfg: AiConfig, fallback: number) {
  if (cfg.timeout_seconds) return cfg.timeout_seconds * 1000;
  return generationOptions(cfg).reasoning_split ? 240_000 : fallback;
}

/**
 * 调用 OpenAI 兼容的 /chat/completions 接口（非流式）。
 * 超时默认 90s；错误信息尽量可读（HTTP 状态 + 响应体）。
 */
export async function chatLlm(opts: {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  cfg?: AiConfig;
}): Promise<ChatResult> {
  const cfg = opts.cfg ?? (await getAiConfig());
  if (!aiReady(cfg)) {
    return { ok: false, error: "AI 网关未配置：请先在工作台「AI 助手 → 网关设置」中填写 Base URL / API Key / 模型并启用" };
  }
  const url = completionsUrl(cfg.base_url);
  const controller = new AbortController();
  const timeout = generationTimeout(cfg, 90_000);
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    assertInputBudget(cfg, opts.messages);
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.api_key}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: opts.messages,
        temperature: opts.temperature ?? cfg.temperature ?? 0.7,
        ...generationOptions(cfg, opts.maxTokens),
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 500);
      return { ok: false, error: `AI 网关返回 HTTP ${res.status}：${body || res.statusText}` };
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string }; finish_reason?: string }[];
      error?: { message?: string };
    };
    if (data.error?.message) return { ok: false, error: `AI 网关错误：${data.error.message}` };
    if (data.choices?.[0]?.finish_reason === "length") return { ok: false, error: "模型输出达到长度上限，回答未完成。请缩短问题或切换模型后重试。" };
    const content = data.choices?.[0]?.message?.content ?? "";
    if (!content) return { ok: false, error: "AI 网关返回了空内容（choices 为空）" };
    return { ok: true, content };
  } catch (err) {
    if ((err as Error).name === "AbortError") return { ok: false, error: `AI 请求超时（${timeout / 1000} 秒）` };
    const msg = (err as Error).message || String(err);
    return { ok: false, error: `AI 请求失败：${msg}` };
  } finally {
    clearTimeout(timer);
  }
}

/** 测试连通：用当前配置发一条最小请求 */
export async function testConnection(): Promise<ChatResult> {
  return chatLlm({ messages: [{ role: "user", content: "ping" }], maxTokens: 8 });
}

/**
 * 调用 OpenAI 兼容的 /chat/completions 接口（流式）。
 * 每产出一段文本立即回调 onDelta；全部完成后 resolve。
 * - 支持外部 signal（如客户端断开/停止）：中止时返回 { ok:false, aborted:true }
 * - 无外部 signal 时内置 120s 兜底超时
 * - 兼容网关直接返回 JSON 的情况，消费同一响应，不重复请求
 */
export async function chatLlmStream(opts: {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  cfg?: AiConfig;
  signal?: AbortSignal;
  onDelta: (text: string) => void;
}): Promise<ChatStreamResult> {
  const cfg = opts.cfg ?? (await getAiConfig());
  if (!aiReady(cfg)) {
    return { ok: false, error: "AI 网关未配置：请先在工作台「AI 助手 → 网关设置」中填写 Base URL / API Key / 模型并启用" };
  }
  const url = completionsUrl(cfg.base_url);

  // 合并外部信号 + 内置超时
  const controller = new AbortController();
  const external = opts.signal;
  const onExternalAbort = () => controller.abort();
  if (external) {
    if (external.aborted) controller.abort();
    else external.addEventListener("abort", onExternalAbort, { once: true });
  }
  const timeout = generationTimeout(cfg, 120_000);
  const timer = setTimeout(() => controller.abort(), timeout);

  let content = "";
  let finishReason: string | undefined;
  try {
    assertInputBudget(cfg, opts.messages);
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.api_key}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: opts.messages,
        temperature: opts.temperature ?? cfg.temperature ?? 0.7,
        stream: true,
        ...generationOptions(cfg, opts.maxTokens),
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 500);
      return { ok: false, error: `AI 网关返回 HTTP ${res.status}：${body || res.statusText}` };
    }
    // Some compatible gateways ignore stream=true and return JSON. Consume that
    // response directly, without replaying the request (which may have side effects).
    if (res.headers.get("content-type")?.includes("application/json")) {
      const data = await res.json() as { choices?: { message?: { content?: string }; finish_reason?: string }[]; error?: { message?: string } };
      if (data.error?.message) return { ok: false, error: `AI 网关错误：${data.error.message}` };
      if (data.choices?.[0]?.finish_reason === "length") return { ok: false, error: "模型输出达到长度上限，回答未完成。请缩短问题或切换模型后重试。" };
      const reply = data.choices?.[0]?.message?.content;
      if (!reply) return { ok: false, error: "AI 网关返回了空内容" };
      opts.onDelta(reply);
      return { ok: true, content: reply };
    }
    if (!res.body) return { ok: false, error: "AI 网关未返回流式内容（body 为空）" };

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      buf += done ? decoder.decode() + "\n" : decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const j = JSON.parse(payload) as {
            choices?: { delta?: { content?: string | null }; finish_reason?: string | null }[];
            error?: { message?: string };
          };
          if (j.error?.message) return { ok: false, error: `AI 网关错误：${j.error.message}` };
          if (j.choices?.[0]?.finish_reason) finishReason = j.choices[0].finish_reason;
          const d = j.choices?.[0]?.delta?.content;
          if (d) {
            content += d;
            try {
              opts.onDelta(d);
            } catch {
              // 回调异常不影响主流程
            }
          }
        } catch {
          // 忽略无法解析的行（keep-alive / 空行等）
        }
      }
      if (done) break;
    }
    if (finishReason === "length") return { ok: false, error: "模型输出达到长度上限，回答未完成。请缩短问题或切换模型后重试。" };
    if (!content.trim()) return { ok: false, error: "AI 网关未返回回答正文（可能仅返回了推理内容），请重试或切换模型" };
    return { ok: true, content };
  } catch (err) {
    const aborted = controller.signal.aborted;
    if ((err as Error).name === "AbortError") {
      return { ok: false, error: aborted ? (external?.aborted ? "已停止生成" : `AI 请求超时（${timeout / 1000} 秒）`) : "AI 请求超时", aborted: external?.aborted === true };
    }
    const msg = (err as Error).message || String(err);
    return { ok: false, error: `AI 请求失败：${msg}` };
  } finally {
    clearTimeout(timer);
    if (external) external.removeEventListener("abort", onExternalAbort);
  }
}

/** 兼容：取默认网关的完整信息（供管理类页面展示多网关用，暂无 UI 则仅默认） */
export async function listGateways(): Promise<AiConfig[]> {
  const all = await rows<AiConfigRow>("SELECT * FROM ai_config ORDER BY id");
  return all.map(rowToConfig);
}

/** 把密钥打码：只保留末 4 位，前缀 ****（空值返回空串） */
export function maskApiKey(key: string): string {
  if (!key) return "";
  if (key.length <= 4) return "****";
  return `****${key.slice(-4)}`;
}
