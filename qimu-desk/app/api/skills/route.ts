import { NextResponse } from "next/server";
import { requireUser, jsonError, readJson, assertOrigin } from "@/core/api";
import {
  listSkills,
  createSkill,
  getSkillDetail,
  type SkillConfig,
  type SkillParam,
  type SkillType,
} from "@/core/skills";
import { normalizeVisibility, defaultVisibility } from "@/core/visibility";
import type { SourceValue } from "@/core/ai/artifacts";

export const dynamic = "force-dynamic";

/** 技能列表（自动播种 skills/ 目录；支持 ?mine=1|public 个人/通用快速筛选） */
export async function GET(req: Request) {
  const user = await requireUser();
  if (!user) return jsonError("未登录", 401);
  const url = new URL(req.url);
  const mineParam = url.searchParams.get("mine");
  const mine = mineParam === "1" || mineParam === "public" ? mineParam : undefined;
  try {
    const skills = await listSkills(user, { mine });
    return NextResponse.json({ skills });
  } catch (e) {
    return jsonError(`获取技能列表失败：${(e as Error).message}`, 500);
  }
}

/** 校验失败：400 + code（写接口契约见 ARCHITECTURE §3.6） */
function badRequest(message: string) {
  return NextResponse.json({ error: message, code: "VALIDATION_ERROR" }, { status: 400 });
}

/** 命名冲突：409 + code + existing（前端「覆盖/另存/放弃」三选一依据） */
function nameConflict(message: string, existing: unknown) {
  return NextResponse.json(
    { error: message, code: "NAME_CONFLICT", existing },
    { status: 409 }
  );
}

/**
 * 新建/覆盖技能：{ name, type, displayName?, description?, color?, params?, config,
 *   visibility?, source?: 'manual'|'ai'（缺省 manual）, mode?: 'create'|'overwrite'（缺省 create） }
 * 只落 DB，不写 skills/<name>/skill.yml。
 * visibility: admin 默认 public、member 默认 personal；owner_id 一律服务端取当前用户。
 */
export async function POST(req: Request) {
  const user = await requireUser();
  if (!user) return jsonError("未登录", 401);
  if (!assertOrigin(req)) return jsonError("来源不合法", 403);

  const body = (await readJson(req)) as Record<string, unknown> | null;
  if (!body) return badRequest("请求体为空");

  const modeRaw = body.mode ?? "create";
  if (modeRaw !== "create" && modeRaw !== "overwrite") {
    return badRequest("mode 只能是 create 或 overwrite");
  }
  const sourceRaw = body.source ?? "manual";
  if (sourceRaw !== "manual" && sourceRaw !== "ai") {
    return badRequest("source 只能是 manual 或 ai");
  }

  try {
    const result = await createSkill(
      {
        name: String(body.name ?? "").trim(),
        type: String(body.type ?? "") as SkillType,
        displayName: body.displayName === undefined ? undefined : String(body.displayName),
        description: body.description === undefined ? undefined : String(body.description),
        color: body.color === undefined ? undefined : String(body.color),
        params: body.params as SkillParam[] | undefined,
        config: (body.config ?? {}) as SkillConfig,
      },
      {
        source: sourceRaw as SourceValue,
        overwrite: modeRaw === "overwrite",
        ownerId: user.id,
        visibility: normalizeVisibility(body.visibility) ?? defaultVisibility(user),
      }
    );

    if (!result.ok) {
      if (result.status === "duplicate") return nameConflict(result.message, result.existing);
      if (result.status === "invalid") return badRequest(result.message);
      return jsonError(result.message, 500);
    }

    const detail = await getSkillDetail(result.id);
    if (!detail) {
      return jsonError(`保存成功但读取失败：技能 #${result.id} 不存在`, 500);
    }
    return NextResponse.json({ ok: true, skill: { ...detail.skill, created: result.created } });
  } catch (e) {
    return jsonError(`保存技能失败：${(e as Error).message}`, 500);
  }
}
