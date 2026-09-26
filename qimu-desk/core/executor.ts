import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

/**
 * 技能 / 工作流共用的执行原语（core/executor.ts）
 *
 * 抽取前：skills.ts 与 workflows.ts 各维护一份同构的 shell/http 执行逻辑
 * （spawn 装配、超时、输出截断、stderr 拼接），改一处忘另一处即行为漂移。
 * 现在统一收敛到这里，两个调用方只负责「渲染参数 + 按结果写运行记录」。
 *
 * 约定：两个函数都不抛异常（除非极端环境错误），一律返回 { output, error }，
 * error 非空即视为失败，由上层决定落库状态与是否中断链路。
 */

export type ExecResult = { output: string; error: string };

export type ShellExecOptions = {
  /** 实际要执行的 shell 命令 */
  command: string;
  /** 超时秒数（1~300，默认 30），超出后终止子进程并视为超时错误 */
  timeoutSec?: number;
  /** 子进程工作目录（默认继承当前进程 cwd） */
  cwd?: string;
  /** stdout/stderr 最大缓冲（默认 1MB） */
  maxBuffer?: number;
};

export type HttpExecOptions = {
  method?: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
  /** 超时秒数（1~120，默认 15） */
  timeoutSec?: number;
  /** 响应体最大保留长度（默认 50000 字符） */
  maxBodyLen?: number;
};

function clamp(v: number | undefined, lo: number, hi: number, def: number): number {
  if (typeof v !== "number" || Number.isNaN(v)) return def;
  return Math.min(Math.max(Math.trunc(v), lo), hi);
}

/** 执行 shell 命令：成功返回合并输出；超时/失败时把已捕获输出放到 output、错误信息放到 error */
export async function runShell(opts: ShellExecOptions): Promise<ExecResult> {
  const timeoutSec = clamp(opts.timeoutSec, 1, 300, 30);
  const maxBuffer = opts.maxBuffer ?? 1024 * 1024;
  try {
    const { stdout, stderr } = await execAsync(opts.command, {
      timeout: timeoutSec * 1000,
      maxBuffer,
      cwd: opts.cwd,
      windowsHide: true,
    });
    const output = `${stdout || ""}${stderr ? `\n[stderr]\n${stderr}` : ""}`.trim() || "（无输出）";
    return { output, error: "" };
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { killed?: boolean; stdout?: string; stderr?: string };
    const output = `${err.stdout || ""}${err.stderr ? `\n[stderr]\n${err.stderr}` : ""}`.trim();
    const error = err.killed
      ? `执行超时（>${timeoutSec}s），进程已终止`
      : `命令执行失败：${err.message}`;
    return { output, error };
  }
}

/**
 * 执行 HTTP 请求：成功（2xx）返回响应文本；非 2xx 或网络错误时 error 非空。
 * body 存在且未显式指定 Content-Type 时自动补 application/json。
 */
export async function runHttp(opts: HttpExecOptions): Promise<ExecResult> {
  const method = (opts.method || "GET").toUpperCase();
  const headers: Record<string, string> = { ...(opts.headers || {}) };
  if (opts.body && !Object.keys(headers).some((k) => k.toLowerCase() === "content-type")) {
    headers["Content-Type"] = "application/json";
  }
  const timeoutSec = clamp(opts.timeoutSec, 1, 120, 15);
  const maxBodyLen = opts.maxBodyLen ?? 50000;
  try {
    const res = await fetch(opts.url, {
      method,
      headers,
      body: opts.body,
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutSec * 1000),
    });
    const text = await res.text();
    const output = `HTTP ${res.status} ${res.statusText}\n\n${text.slice(0, maxBodyLen)}`;
    return res.ok
      ? { output, error: "" }
      : { output, error: `接口返回非成功状态码 HTTP ${res.status}` };
  } catch (e) {
    return { output: "", error: `请求失败：${(e as Error).message}` };
  }
}
