/**
 * 定时任务 cron 工具（前后端共享纯函数，勿引入浏览器/服务端专属 API）
 *
 * cron 采用标准 5 段式：`分 时 日 月 周`
 * - 周字段：0 或 7 为周日，1-6 为周一至周六（本工具统一归一为 0）
 * - 界面只编排三类周期模板：每天 / 每周（多选星期）/ 每月（指定几号）
 * - 解析与"下次执行时间"对任意合法 cron 均可用，为将来 node-cron 自动调度预留
 */

export type CronFreq = "daily" | "weekly" | "monthly";

/** 周期模板表单值 */
export type ScheduleRule = {
  freq: CronFreq;
  /** "HH:mm" */
  time: string;
  /** weekly 时选中的星期（cron 数值，周日=0） */
  weekdays: number[];
  /** monthly 时执行日 1-31 */
  monthDay: number;
};

/** 星期完整名，index 0=周日（与 cron / JS Date#getDay 对齐） */
export const WEEKDAY_FULL = [
  "周日",
  "周一",
  "周二",
  "周三",
  "周四",
  "周五",
  "周六",
] as const;

/** 表单可选星期（周一 → 周日，周日存 0） */
export const WEEKDAY_OPTIONS: { value: number; label: string }[] = [
  1, 2, 3, 4, 5, 6, 0,
].map((v) => ({ value: v, label: WEEKDAY_FULL[v] }));

export const CRON_FREQ_LABEL: Record<CronFreq, string> = {
  daily: "每天",
  weekly: "每周",
  monthly: "每月",
};

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** 归一星期：cron 中 7 等价于 0（周日） */
export function normalizeDow(v: number): number {
  return v % 7;
}

/* ------------------------------------------------------------------ */
/* 解析：支持 *（任意）、步进 a/b、范围 a-b、枚举 a,b,c；越界返回 null      */
/* ------------------------------------------------------------------ */

type CronParts = {
  minute: Set<number> | null;
  hour: Set<number> | null;
  dom: Set<number> | null;
  month: Set<number> | null;
  dow: Set<number> | null;
};

const FIELD_BOUNDS: [number, number][] = [
  [0, 59], // minute
  [0, 23], // hour
  [1, 31], // day of month
  [1, 12], // month
  [0, 7], // day of week（7 归一 0）
];

function parseSegment(raw: string, min: number, max: number): Set<number> | null {
  if (raw === "*") return null;
  const out = new Set<number>();
  const addVal = (v: number) => {
    if (!Number.isInteger(v) || v < min || v > max) throw new RangeError(`cron 值 ${v} 越界 [${min},${max}]`);
    out.add(v);
    return true;
  };
  for (const token of raw.split(",")) {
    if (token === "*") {
      // "*,x" 视为全部，直接返回 null（语义同 *）
      return null;
    }
    const stepMatch = /^\*\/(\d+)$/.exec(token);
    if (stepMatch) {
      const step = Number(stepMatch[1]);
      if (step < 1) throw new RangeError("cron 步进必须 ≥1");
      for (let v = min; v <= max; v += step) out.add(v);
      continue;
    }
    const rangeStep = /^(\d+)-(\d+)(?:\/(\d+))?$/.exec(token);
    if (rangeStep) {
      const a = Number(rangeStep[1]);
      const b = Number(rangeStep[2]);
      const step = rangeStep[3] ? Number(rangeStep[3]) : 1;
      if (step < 1) throw new RangeError("cron 步进必须 ≥1");
      if (a < min || b > max || a > b) throw new RangeError(`cron 范围 ${a}-${b} 越界`);
      for (let v = a; v <= b; v += step) out.add(v);
      continue;
    }
    addVal(Number(token));
  }
  return out.size > 0 ? out : null;
}

export function parseCron(cron: string): CronParts | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  try {
    const segs = parts.map((p, i) => parseSegment(p, FIELD_BOUNDS[i][0], FIELD_BOUNDS[i][1]));
    const [minute, hour, dom, month, dowRaw] = segs as (Set<number> | null)[];
    let dow = dowRaw;
    if (dowRaw && dowRaw.has(7)) {
      // 7 → 0（周日），保留 7 之外的成员
      dow = new Set<number>([...(dowRaw ?? [])].filter((v) => v !== 7).map(normalizeDow));
      if (dow.size === 0) dow.add(0);
    }
    return { minute, hour, dom, month, dow };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* 模板 ↔ cron 互转                                                     */
/* ------------------------------------------------------------------ */

/** 把周期模板编译成 5 段 cron；不合法返回 null */
export function ruleToCron(rule: ScheduleRule): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(rule.time);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;

  const base = `${min} ${h}`;
  if (rule.freq === "daily") return `${base} * * *`;
  if (rule.freq === "weekly") {
    const days = [...new Set(rule.weekdays.map(normalizeDow))].sort((a, b) => a - b);
    if (days.length === 0) return null;
    return `${base} * * ${days.join(",")}`;
  }
  if (rule.freq === "monthly") {
    const d = Number(rule.monthDay);
    if (!Number.isInteger(d) || d < 1 || d > 31) return null;
    return `${base} ${d} * *`;
  }
  return null;
}

/** 从 cron 反解模板（仅能识别"每天/每周/每月"三类形态），否则返回 null */
export function cronToRule(cron: string): ScheduleRule | null {
  const p = parseCron(cron);
  if (!p) return null;
  if (p.month) return null; // 限定月份不属于界面模板
  if (p.minute === null || p.hour === null) return null; // 需要明确的时:分
  const first = (s: Set<number> | null) => (s && s.size === 1 ? [...s][0] : null);
  const minute = first(p.minute);
  const hour = first(p.hour);
  if (minute === null || hour === null) return null;
  const time = `${pad2(hour)}:${pad2(minute)}`;

  if (p.dom === null && p.dow === null) return { freq: "daily", time, weekdays: [], monthDay: 1 };
  if (p.dom === null && p.dow !== null) {
    return { freq: "weekly", time, weekdays: [...p.dow].sort((a, b) => a - b), monthDay: 1 };
  }
  if (p.dom !== null && p.dow === null) {
    if (p.dom.size === 1) {
      return { freq: "monthly", time, weekdays: [], monthDay: [...p.dom][0] };
    }
    // 多天（如每月 1 号、15 号）超模板，不支持反解
    return null;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* 展示：人类可读描述 + 下次执行时间                                      */
/* ------------------------------------------------------------------ */

/** 中文周期描述；无法结构化时退回原始 cron */
export function cronDescription(cron: string): string {
  const p = parseCron(cron);
  if (!p) return `自定义（${cron}）`;
  const minute = p.minute === null ? null : [...p.minute];
  const hour = p.hour === null ? null : [...p.hour];
  if (minute && hour && minute.length === 1 && hour.length === 1) {
    const time = `${pad2(hour[0])}:${pad2(minute[0])}`;
    if (p.dom === null && p.dow === null && p.month === null) return `每天 ${time}`;
    if (p.dom === null && p.dow !== null && p.month === null) {
      // 按一周顺序展示（周一起始），周日(0)排末尾
      const days = [...p.dow].sort((a, b) => (a + 6) % 7 - (b + 6) % 7);
      if (days.length === 7) return `每天 ${time}`;
      const names = days.map((d) => WEEKDAY_FULL[d]).join("、");
      return `每周${names} ${time}`;
    }
    if (p.dom !== null && p.dow === null && p.month === null) {
      const doms = [...p.dom].sort((a, b) => a - b);
      const dayText = doms.map((d) => `${d}号`).join("、");
      return `每月${dayText} ${time}`;
    }
  }
  if (minute === null && hour === null && p.dom === null && p.dow === null && p.month === null) {
    return "每分钟";
  }
  return `自定义（${cron}）`;
}

/** 判断日期是否命中某条 cron（遵循 Vixie cron：日与周同时受限时取并集） */
function matchesCron(d: Date, p: CronParts): boolean {
  if (p.minute && !p.minute.has(d.getMinutes())) return false;
  if (p.hour && !p.hour.has(d.getHours())) return false;
  if (p.month && !p.month.has(d.getMonth() + 1)) return false;
  const domOk = !p.dom || p.dom.has(d.getDate());
  const dowOk = !p.dow || p.dow.has(d.getDay()); // JS getDay: 0=周日，与 cron 一致
  return p.dom && p.dow ? domOk || dowOk : domOk && dowOk;
}

/** 计算 from 之后的下一次执行时间；三年内无匹配返回 null */
export function cronNext(cron: string, from: Date = new Date()): Date | null {
  const p = parseCron(cron);
  if (!p) return null;
  const limit = from.getTime() + 3 * 366 * 24 * 3600 * 1000;
  const d = new Date(from);
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1); // 从下一分钟开始找
  while (d.getTime() <= limit) {
    if (matchesCron(d, p)) return d;
    d.setMinutes(d.getMinutes() + 1);
  }
  return null;
}

/** 本地时间格式化 "MM-DD HH:mm"（跨年含年份前缀） */
export function formatCronDate(d: Date, now: Date = new Date()): string {
  const sameYear = d.getFullYear() === now.getFullYear();
  const md = `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  return sameYear ? md : `${d.getFullYear()}-${md}`;
}
