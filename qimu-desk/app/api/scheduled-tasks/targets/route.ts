import { NextResponse } from "next/server";
import { rows } from "@/core/db";
import { requireUser, jsonError } from "@/core/api";
import { listSkills } from "@/core/skills";
import { listWorkflows } from "@/core/workflows";

export const dynamic = "force-dynamic";

/**
 * 获取技能和工作流列表，供定时任务选择关联目标
 * GET /api/scheduled-tasks/targets
 */
export async function GET(req: Request) {
  const user = await requireUser();
  if (!user) return jsonError("未登录", 401);

  try {
    const [skills, workflows] = await Promise.all([
      listSkills(user).then((list) =>
        list.map((s) => ({
          id: s.id,
          name: s.name,
          displayName: s.displayName,
          type: s.type,
        }))
      ),
      listWorkflows(user).then((list) =>
        list.map((w) => ({
          id: w.id,
          name: w.name,
          displayName: w.displayName,
        }))
      ),
    ]);

    return NextResponse.json({ skills, workflows });
  } catch (e) {
    return jsonError(`获取目标列表失败：${(e as Error).message}`, 500);
  }
}
