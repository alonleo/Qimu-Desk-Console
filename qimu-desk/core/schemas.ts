import { z } from "zod";

/**
 * 公共入参校验 Schema（core/schemas.ts）
 *
 * 背景：早期只有 /api/auth/login 使用 zod，其余 route 手写 if 守卫，规则分散易漏。
 * 现在把 AI 对话、任务、项目等高频写入接口的入参收敛到此处，route 层统一
 * `schema.safeParse(await readJson(req))`，与 login 对齐。新增接口请优先在此定义。
 */

/**
 * 用户消息携带的技能/工作流引用元数据（紧凑形态，不含 config/params）。
 * 全部字段可选除 id 外，向后兼容老客户端（不带即不透传）。
 */
export const chatRefMetaSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().optional(),
  displayName: z.string().optional(),
  description: z.string().optional(),
});

/** AI 对话消息 */
export const chatMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string(),
  /** 该条用户消息引用的技能（用于跨轮次重建引用上下文；服务端只读，不回传前端） */
  usedSkills: z.array(chatRefMetaSchema).optional(),
  /** 该条用户消息引用的工作流（同上） */
  usedWorkflows: z.array(chatRefMetaSchema).optional(),
});

/** POST /api/ai/chat 请求体 */
export const aiChatSchema = z.object({
  messages: z.array(chatMessageSchema).min(1, "messages 不能为空").max(60, "消息数量超出限制"),
  useKnowledge: z.boolean().optional(),
  category: z.string().optional(),
  tag: z.string().optional(),
  gatewayId: z.number().int().positive().optional(),
  stream: z.boolean().optional(),
  skillIds: z.array(z.number().int().positive()).optional(),
  workflowIds: z.array(z.number().int().positive()).optional(),
  capabilityIds: z.array(z.number().int().positive()).max(10).default([]),
  allowToolCalls: z.boolean().default(false),
});

/** 任务合法枚举 */
export const taskStatusSchema = z.enum(["todo", "doing", "waiting", "done"]);
export const taskPrioritySchema = z.enum(["low", "normal", "high", "urgent"]);
export const taskPeriodSchema = z.enum(["daily", "weekly"]).nullable().optional();

/** 可见性合法枚举（personal=个人 / public=通用；与 core/visibility.ts、后端 VisibilityPolicy 对齐） */
export const visibilityEnumSchema = z.enum(["personal", "public"]);
/** 创建/更新入参中的可选可见性 */
export const visibilitySchema = visibilityEnumSchema.optional();

/** POST /api/tasks 创建任务 */
export const taskCreateSchema = z.object({
  title: z.string().trim().min(1, "任务标题不能为空").max(200, "标题过长"),
  projectId: z
    .number()
    .int()
    .min(1, "无效项目 ID")
    .nullable()
    .optional(),
  status: taskStatusSchema.default("todo"),
  priority: taskPrioritySchema.default("normal"),
  notes: z.string().trim().max(2000, "备注过长").nullable().optional(),
  dueDate: z.string().max(32).nullable().optional(),
  startDate: z.string().max(32).nullable().optional(),
  period: taskPeriodSchema,
  visibility: visibilitySchema,
});

/** PATCH /api/tasks/:id 更新任务（全部可选，至少一个字段） */
export const taskUpdateSchema = z
  .object({
    title: z.string().trim().min(1, "标题不能为空").max(200, "标题过长").optional(),
    projectId: z.number().int().min(1, "无效项目 ID").nullable().optional(),
    status: taskStatusSchema.optional(),
    priority: taskPrioritySchema.optional(),
    notes: z.string().trim().max(2000, "备注过长").nullable().optional(),
    dueDate: z.string().max(32).nullable().optional(),
    startDate: z.string().max(32).nullable().optional(),
    period: taskPeriodSchema,
    visibility: visibilitySchema,
  })
  .refine((v) => Object.keys(v).length > 0, "无更新字段");

/** 项目状态合法枚举 */
export const projectStatusSchema = z.enum(["active", "archived"]);

/** 把 null/空串/undefined 归一化为 null，字符串则 trim + 截断（对齐原 route 手写行为，超长截断不报错） */
const nullableText = (maxLen: number) =>
  z.preprocess(
    (v) => {
      if (v === null || v === undefined) return null;
      const s = String(v).trim();
      return s.length > maxLen ? s.slice(0, maxLen) : s || null;
    },
    z.string().nullable()
  );

/** POST /api/projects 创建项目 */
export const projectCreateSchema = z.object({
  name: z.string().trim().min(1, "项目名称不能为空").max(100, "项目名称过长"),
  description: nullableText(500).optional(),
  color: nullableText(32).optional(),
  status: projectStatusSchema.default("active"),
  visibility: visibilitySchema,
});

/** PATCH /api/projects/:id 更新项目（至少一个字段） */
export const projectUpdateSchema = z
  .object({
    name: z.string().trim().min(1, "项目名称不能为空").max(100, "项目名称过长").optional(),
    description: nullableText(500).optional(),
    color: nullableText(32).optional(),
    status: projectStatusSchema.optional(),
    visibility: visibilitySchema,
  })
  .refine((v) => Object.keys(v).length > 0, "无更新字段");

/** 统一读取解析后的错误文案（优先第一条 message，其次第一个 issue path） */
export function firstZodError(result: { error: z.ZodError }): string {
  return result.error.issues[0]?.message || "参数校验失败";
}
