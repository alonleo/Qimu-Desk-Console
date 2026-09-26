import { NextResponse } from "next/server";
import { rows, row, exec } from "@/core/db";
import { parseCron, cronNext } from "@/components/tasks/schedule";
import { runSkill } from "@/core/skills";
import { startWorkflowRun } from "@/core/workflows";

export const dynamic = "force-dynamic";

/** 调度执行 API（由外部 cron 每分钟调用一次） */
export async function POST(req: Request) {
  // 简单的密钥验证，防止未授权调用
  const authHeader = req.headers.get("authorization");
  const expectedToken = process.env.SCHEDULED_TASK_TOKEN;
  if (expectedToken && authHeader !== `Bearer ${expectedToken}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const nowStr = now.toISOString().slice(0, 19).replace("T", " ");
  const minuteKey = `${now.getHours()}:${now.getMinutes()}`;

  // 获取所有启用的定时任务
  const tasks = await rows<{
    id: number;
    name: string;
    cron: string;
    target_type: string | null;
    target_id: number | null;
    params: string | null;
    last_run_at: string | null;
  }>(`SELECT id, name, cron, target_type, target_id, params, last_run_at FROM scheduled_tasks WHERE enabled = 1`);

  let executed = 0;
  let skipped = 0;
  const errors: { taskId: number; name: string; error: string }[] = [];

  for (const task of tasks) {
    // 检查是否应该执行
    const shouldRun = shouldExecuteNow(task.cron, now);
    if (!shouldRun) {
      skipped++;
      continue;
    }

    // 如果设置了目标，执行技能或工作流
    if (task.target_type && task.target_id) {
      try {
        let params: Record<string, unknown> = {};
        if (task.params) {
          try {
            params = JSON.parse(task.params);
          } catch {
            // ignore invalid JSON
          }
        }

        if (task.target_type === "skill") {
          // 执行技能
          await runSkill(task.target_id, params, "scheduled");
        } else if (task.target_type === "workflow") {
          // 执行工作流（异步）
          const proto = req.headers.get("x-forwarded-proto") || "http";
          const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
          const baseUrl = host ? `${proto}://${host}` : undefined;
          await startWorkflowRun(task.target_id, params, "scheduled", baseUrl);
        }

        // 更新 last_run_at
        await exec("UPDATE scheduled_tasks SET last_run_at = NOW() WHERE id = ?", [task.id]);
        executed++;
      } catch (e) {
        errors.push({ taskId: task.id, name: task.name, error: (e as Error).message });
        // 即使执行失败也更新时间戳，避免重复尝试
        await exec("UPDATE scheduled_tasks SET last_run_at = NOW() WHERE id = ?", [task.id]).catch(() => {});
      }
    } else {
      // 无目标时只更新时间戳
      await exec("UPDATE scheduled_tasks SET last_run_at = NOW() WHERE id = ?", [task.id]);
      executed++;
    }
  }

  return NextResponse.json({
    checked: tasks.length,
    executed,
    skipped,
    errors: errors.length > 0 ? errors : undefined,
    timestamp: nowStr,
  });
}

/**
 * 判断当前时刻是否应该执行该 cron
 * 注意：这是简化版实现，仅检查分钟级别
 */
function shouldExecuteNow(cron: string, now: Date): boolean {
  const p = parseCron(cron);
  if (!p) return false;

  const minute = now.getMinutes();
  const hour = now.getHours();
  const day = now.getDate();
  const month = now.getMonth() + 1;
  const dow = now.getDay();

  // 检查分钟
  if (p.minute !== null && !p.minute.has(minute)) return false;
  // 检查小时
  if (p.hour !== null && !p.hour.has(hour)) return false;
  // 检查月份
  if (p.month !== null && !p.month.has(month)) return false;

  // 日与周：Vixie cron 语义，两者都设时取并集
  if (p.dom !== null && p.dow !== null) {
    // 两者都设时，满足任一即可
    return p.dom.has(day) || p.dow.has(dow);
  }
  if (p.dom !== null && !p.dom.has(day)) return false;
  if (p.dow !== null && !p.dow.has(dow)) return false;

  return true;
}
