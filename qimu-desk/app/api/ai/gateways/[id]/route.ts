import { NextResponse } from "next/server";
import { row, rows, withTransaction } from "@/core/db";
import { assertOrigin, jsonError, requireAdmin, readJson } from "@/core/api";
import { maskApiKey } from "@/core/llm";

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

async function loadOne(id: number): Promise<GatewayRow | null> {
  return row<GatewayRow>(
    "SELECT id, name, provider, base_url, api_key, model, temperature, enabled, is_default, updated_at FROM ai_config WHERE id = ?",
    [id]
  );
}

/** PATCH /api/ai/gateways/[id] —— 修改一个网关；支持 is_default 切换 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!assertOrigin(req)) return jsonError("跨域请求被拒绝", 403);
  const admin = await requireAdmin();
  if (!admin) return jsonError("仅管理员可修改 AI 网关", 403);

  const { id: idStr } = await ctx.params;
  const id = Number(idStr);
  if (!Number.isInteger(id) || id <= 0) return jsonError("无效的网关 id", 400);

  const body = (await readJson(req)) as Record<string, unknown> | null;
  if (!body) return jsonError("请求体缺失", 400);

  const cur = await loadOne(id);
  if (!cur) return jsonError("网关不存在", 404);

  // 字段：未提供则保留旧值；空字符串视为清空
  const pickStr = (k: string): string | undefined => {
    if (typeof body[k] !== "string") return undefined;
    return (body[k] as string).trim();
  };
  const next = {
    name: pickStr("name") ?? cur.name,
    provider: pickStr("provider") ?? cur.provider,
    base_url: pickStr("base_url") ?? cur.base_url,
    api_key: typeof body.api_key === "string" ? (body.api_key as string).trim() : cur.api_key,
    model: pickStr("model") ?? cur.model,
    temperature:
      typeof body.temperature === "number" && Number.isFinite(body.temperature)
        ? Math.min(Math.max(body.temperature, 0), 2)
        : Number(cur.temperature),
    enabled: typeof body.enabled === "boolean" ? body.enabled : !!cur.enabled,
    is_default: typeof body.is_default === "boolean" ? body.is_default : !!cur.is_default,
  };

  // api_key 提交打码形式 → 保留旧值
  if (next.api_key.startsWith("****")) next.api_key = cur.api_key;

  // 基础校验（更新走 is_default=1 至少要 enabled 且字段齐）
  if (next.is_default && (!next.enabled || !next.base_url || !next.api_key || !next.model)) {
    return jsonError("设为默认网关前，请先填齐 Base URL / API Key / 模型并启用", 400);
  }

  try {
    await withTransaction(async ({ exec: txExec }) => {
      // 切默认：先把其它网关的 is_default 清掉
      if (next.is_default && !cur.is_default) {
        await txExec("UPDATE ai_config SET is_default = 0, updated_at = NOW() WHERE id <> ?", [id]);
      }
      // 不再是默认且当前是默认：自动指派另一条启用中的网关作默认
      if (!next.is_default && cur.is_default) {
        const others = await rows<{ id: number }>(
          "SELECT id FROM ai_config WHERE id <> ? AND enabled = 1 ORDER BY id LIMIT 1",
          [id]
        );
        if (others.length > 0) {
          await txExec("UPDATE ai_config SET is_default = 1, updated_at = NOW() WHERE id = ?", [
            others[0].id,
          ]);
        }
      }
      await txExec(
        `UPDATE ai_config SET
           name = ?, provider = ?, base_url = ?, api_key = ?, model = ?,
           temperature = ?, enabled = ?, is_default = ?, updated_at = NOW()
         WHERE id = ?`,
        [
          next.name,
          next.provider,
          next.base_url,
          next.api_key,
          next.model,
          next.temperature,
          next.enabled ? 1 : 0,
          next.is_default ? 1 : 0,
          id,
        ]
      );
    });
  } catch (e) {
    return jsonError(`修改 AI 网关失败：${(e as Error).message}`, 500);
  }

  const updated = await loadOne(id);
  return NextResponse.json({ ok: true, gateway: updated ? rowToDto(updated) : null });
}

/** DELETE /api/ai/gateways/[id] —— 删除一个网关（至少保留一条；删默认时自动替补） */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!assertOrigin(req)) return jsonError("跨域请求被拒绝", 403);
  const admin = await requireAdmin();
  if (!admin) return jsonError("仅管理员可删除 AI 网关", 403);

  const { id: idStr } = await ctx.params;
  const id = Number(idStr);
  if (!Number.isInteger(id) || id <= 0) return jsonError("无效的网关 id", 400);

  const cur = await loadOne(id);
  if (!cur) return jsonError("网关不存在", 404);

  const count = await row<{ c: number }>("SELECT COUNT(*) AS c FROM ai_config");
  if ((count?.c ?? 0) <= 1) return jsonError("至少保留一个 AI 网关", 400);

  try {
    await withTransaction(async ({ exec: txExec }) => {
      // 删的是默认：自动晋升另一条作为默认（保证 DB 中至少有一行 is_default=1）
      if (cur.is_default) {
        // 优先选另一条启用中的；都没有再选任意一条
        const others =
          (await rows<{ id: number }>(
            "SELECT id FROM ai_config WHERE id <> ? AND enabled = 1 ORDER BY id LIMIT 1",
            [id]
          )).length > 0
            ? await rows<{ id: number }>(
                "SELECT id FROM ai_config WHERE id <> ? AND enabled = 1 ORDER BY id LIMIT 1",
                [id]
              )
            : await rows<{ id: number }>(
                "SELECT id FROM ai_config WHERE id <> ? ORDER BY id LIMIT 1",
                [id]
              );
        if (others.length > 0) {
          await txExec("UPDATE ai_config SET is_default = 1, updated_at = NOW() WHERE id = ?", [
            others[0].id,
          ]);
        }
      }
      await txExec("DELETE FROM ai_config WHERE id = ?", [id]);
    });
  } catch (e) {
    return jsonError(`删除 AI 网关失败：${(e as Error).message}`, 500);
  }

  return NextResponse.json({ ok: true });
}
