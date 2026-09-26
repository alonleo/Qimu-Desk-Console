import { NextResponse } from "next/server";
import { assertOrigin, jsonError, requireUser, requireAdmin, readJson } from "@/core/api";
import { getAiConfig, saveAiConfig, maskApiKey, parseGatewayLimits } from "@/core/llm";

export async function GET(req: Request) {
  if (!assertOrigin(req)) return jsonError("跨域请求被拒绝", 403);
  const user = await requireUser();
  if (!user) return jsonError("未登录", 401);

  const cfg = await getAiConfig();
  return NextResponse.json({
    ok: true,
    config: { ...cfg, api_key: cfg.api_key ? maskApiKey(cfg.api_key) : "" },
  });
}

export async function PUT(req: Request) {
  if (!assertOrigin(req)) return jsonError("跨域请求被拒绝", 403);
  const admin = await requireAdmin();
  if (!admin) return jsonError("仅管理员可修改 AI 网关配置", 403);

  const body = (await readJson(req)) as Record<string, unknown> | null;
  if (!body) return jsonError("请求体缺失", 400);

  let limits;
  try { limits = parseGatewayLimits(body); } catch (e) { return jsonError((e as Error).message, 400); }

  // apiKey 若为打码形式（**** 开头）则视为未修改，保留旧值
  const cur = await getAiConfig();
  let apiKey = typeof body.api_key === "string" ? body.api_key.trim() : cur.api_key;
  if (apiKey.startsWith("****")) apiKey = cur.api_key;

  const cfg = await saveAiConfig({
    ...limits,
    provider: typeof body.provider === "string" ? body.provider : undefined,
    base_url: typeof body.base_url === "string" ? body.base_url : undefined,
    api_key: apiKey,
    model: typeof body.model === "string" ? body.model : undefined,
    temperature:
      typeof body.temperature === "number" && Number.isFinite(body.temperature)
        ? Math.min(Math.max(body.temperature, 0), 2)
        : undefined,
    enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
  });

  return NextResponse.json({
    ok: true,
    config: { ...cfg, api_key: cfg.api_key ? maskApiKey(cfg.api_key) : "" },
  });
}
