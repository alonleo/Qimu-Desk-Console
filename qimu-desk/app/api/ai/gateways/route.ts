import { NextResponse } from "next/server";
import { exec, row, rows, withTransaction } from "@/core/db";
import { assertOrigin, jsonError, requireAdmin, requireUser, readJson } from "@/core/api";
import { maskApiKey } from "@/core/llm";

/**
 * AI 网关表 ai_config 字段（与后端 schema 对齐）：
 *   id, name, provider, base_url, api_key, model, temperature, enabled, is_default
 * 至少保留一条网关（删除最后一条时被阻止）。
 */
type GatewayRow = {
  id: number;
  name: string;
  provider: string;
  base_url: string;
  api_key: string;
  model: string;
  temperature: number;
  enabled: number;
  is_default: number;
  updated_at: string | null;
};

function rowToDto(r: GatewayRow) {
  return {
    id: r.id,
    name: r.name,
    provider: r.provider,
    base_url: r.base_url,
    api_key: maskApiKey(r.api_key),
    model: r.model,
    temperature: Number(r.temperature),
    enabled: !!r.enabled,
    is_default: !!r.is_default,
    updated_at: r.updated_at,
  };
}

/** GET /api/ai/gateways —— 列出所有网关（任意登录用户；key 已打码） */
export async function GET(req: Request) {
  if (!assertOrigin(req)) return jsonError("跨域请求被拒绝", 403);
  const user = await requireUser();
  if (!user) return jsonError("未登录", 401);

  try {
    const list = await rows<GatewayRow>(
      "SELECT id, name, provider, base_url, api_key, model, temperature, enabled, is_default, updated_at FROM ai_config ORDER BY is_default DESC, id"
    );
    const defaultRow = list.find((r) => r.is_default) || list[0] || null;
    return NextResponse.json({
      ok: true,
      gateways: list.map(rowToDto),
      defaultId: defaultRow?.id ?? null,
    });
  } catch (e) {
    return jsonError(`加载 AI 网关失败：${(e as Error).message}`, 500);
  }
}

/** POST /api/ai/gateways —— 新建网关（仅管理员） */
export async function POST(req: Request) {
  if (!assertOrigin(req)) return jsonError("跨域请求被拒绝", 403);
  const admin = await requireAdmin();
  if (!admin) return jsonError("仅管理员可新增 AI 网关", 403);

  const body = (await readJson(req)) as Record<string, unknown> | null;
  if (!body) return jsonError("请求体缺失", 400);

  const name = String(body.name ?? "").trim();
  const baseUrl = String(body.base_url ?? "").trim();
  const apiKey = typeof body.api_key === "string" ? body.api_key.trim() : "";
  const model = String(body.model ?? "").trim();
  if (!name) return jsonError("请输入网关名称", 400);
  if (!baseUrl) return jsonError("请输入网关地址", 400);
  if (!model) return jsonError("请输入模型名称", 400);
  if (!apiKey) return jsonError("请输入 API Key", 400);

  const provider = String(body.provider ?? "openai-compatible").trim() || "openai-compatible";
  const temperature =
    typeof body.temperature === "number" && Number.isFinite(body.temperature)
      ? Math.min(Math.max(body.temperature, 0), 2)
      : 0.7;
  const enabled = body.enabled === true;

  try {
    const result = await withTransaction(async ({ exec: txExec }) => {
      // 全表都没有默认时，新建的第一个自动成为默认
      const any = await row<{ c: number }>("SELECT COUNT(*) AS c FROM ai_config");
      const isDefault = (any?.c ?? 0) === 0 ? 1 : 0;
      const info = await txExec(
        `INSERT INTO ai_config (name, provider, base_url, api_key, model, temperature, enabled, is_default)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [name, provider, baseUrl, apiKey, model, temperature, enabled ? 1 : 0, isDefault]
      );
      return { id: info.insertId, isDefault };
    });
    const created = await row<GatewayRow>(
      "SELECT id, name, provider, base_url, api_key, model, temperature, enabled, is_default, updated_at FROM ai_config WHERE id = ?",
      [result.id]
    );
    return NextResponse.json({ ok: true, gateway: created ? rowToDto(created) : null });
  } catch (e) {
    return jsonError(`新建 AI 网关失败：${(e as Error).message}`, 500);
  }
}
