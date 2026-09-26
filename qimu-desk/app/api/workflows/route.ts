import { NextResponse } from "next/server";
import { requireUser, jsonError, readJson, assertOrigin } from "@/core/api";
import {
  listWorkflows,
  createWorkflow,
  getWorkflowDetail,
  type WorkflowStep,
} from "@/core/workflows";
import { normalizeVisibility, defaultVisibility } from "@/core/visibility";
import type { SkillParam } from "@/core/skills";
import type { SourceValue } from "@/core/ai/artifacts";

export const dynamic = "force-dynamic";

/** 工作流列表（自动播种 workflows/ 目录；支持 ?mine=1|public 个人/通用快速筛选） */
export async function GET(req: Request) {
  const user = await requireUser();
  if (!user) return jsonError("未登录", 401);
  const url = new URL(req.url);
  const mineParam = url.searchParams.get("mine");
  const mine = mineParam === "1" || mineParam === "public" ? mineParam : undefined;
  try {
    const workflows = await listWorkflows(user, { mine });
    return NextResponse.json({ workflows });
  } catch (e) {
    return jsonError(`获取工作流列表失败：${(e as Error).message}`, 500);
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
 * 新建/覆盖工作流：{ name, displayName?, description?, color?, params?, steps, visibility?,
 *   source?: 'manual'|'ai'（缺省 manual）, mode?: 'create'|'overwrite'（缺省 create） }
 * 只落 DB，不写 workflows/<name>.yml。
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
    const result = await createWorkflow(
      {
        name: String(body.name ?? "").trim(),
        displayName: body.displayName === undefined ? undefined : String(body.displayName),
        description: body.description === undefined ? undefined : String(body.description),
        color: body.color === undefined ? undefined : String(body.color),
        params: body.params as SkillParam[] | undefined,
        steps: body.steps as WorkflowStep[],
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

    const detail = await getWorkflowDetail(result.id);
    if (!detail) {
      return jsonError(`保存成功但读取失败：工作流 #${result.id} 不存在`, 500);
    }
    return NextResponse.json({ ok: true, workflow: { ...detail.workflow, created: result.created } });
  } catch (e) {
    return jsonError(`保存工作流失败：${(e as Error).message}`, 500);
  }
}
