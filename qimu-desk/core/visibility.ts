/**
 * 可见性体系共享常量与工具（架构 §六 唯一 TS 出处）
 *
 * - 取值：visibility ∈ { "personal", "public" }；Java 侧唯一出处为
 *   admin-backend `common/VisibilityPolicy.java`，两侧禁止硬编码。
 * - 判定规则（唯一真源 §3.4）：
 *   读：member 可见 = visibility='public' OR owner_id=自己；admin 全量；
 *   写：member 可写 = owner_id 非空且 = 自己（通用条目 owner-only 只读共享）；
 *       admin 全权；owner_id NULL（旧通用数据）member 只读。
 * - 降级语义：旧库缺列时行数据无 visibility/owner_id 字段（undefined）→ 按 public/NULL 处理，
 *   宁多见不误伤；禁止在降级分支做可见性过滤。
 */

export type VisibilityValue = "personal" | "public";

export const VISIBILITY_PERSONAL: VisibilityValue = "personal";
export const VISIBILITY_PUBLIC: VisibilityValue = "public";

/** 全部合法取值（后端白名单校验用） */
export const VISIBILITY_VALUES: VisibilityValue[] = ["personal", "public"];

/** 文案映射（渲染唯一出处 components/VisibilityTag.tsx / VisibilitySelect.tsx） */
export const VISIBILITY_LABEL: Record<VisibilityValue, string> = {
  personal: "个人",
  public: "通用",
};

/** 工作台当前用户最小形态（core/auth.ts User 的结构子集，避免循环依赖） */
export type VisibilityUser = { id: number; role: "admin" | "member" } | null;

/**
 * 归一化任意入参为合法可见性值；非法返回 null（由调用方按角色取默认）。
 * 与 Java VisibilityPolicy.resolveVisibility/parseVisibility 同语义。
 */
export function normalizeVisibility(v: unknown): VisibilityValue | null {
  return v === "personal" || v === "public" ? v : null;
}

/** 创建默认值：admin → public（与旧数据一致），member → personal（个人工作台心智） */
export function defaultVisibility(user: VisibilityUser): VisibilityValue {
  return user?.role === "admin" ? "public" : "personal";
}

/**
 * member 列表过滤 SQL 片段：返回 { clause, params }，直接拼进 WHERE。
 * - member：clause = `AND (x.visibility='public' OR x.owner_id=?)`，params = [user.id]；
 * - admin / 未登录上下文由调用方 fail-closed：admin 返回空；null 视为 member（uid=-1 恒不匹配私有）。
 */
export function memberScopeSql(
  user: { id: number; role: "admin" | "member" } | null,
  alias: string
): { clause: string; params: (string | number)[] } {
  if (user?.role === "admin") return { clause: "", params: [] };
  const uid = user ? user.id : -1;
  return {
    clause: ` AND (${alias}.visibility = 'public' OR ${alias}.owner_id = ?)`,
    params: [uid],
  };
}

/**
 * 前端按钮显隐判定（与服务端 canWrite 同一规则）：
 * member 可写 = owner_id 非空且等于自己；admin 全权；owner_id NULL（旧通用数据）member 只读。
 */
export function canEditRow(
  user: VisibilityUser,
  row: { visibility?: VisibilityValue | string | null; owner_id?: number | string | null } | null | undefined
): boolean {
  if (!user || !row) return false;
  if (user.role === "admin") return true;
  const ownerId = row.owner_id === null || row.owner_id === undefined ? null : Number(row.owner_id);
  return ownerId !== null && ownerId === user.id;
}

/** 行数据可见性归一化：缺列/NULL（降级或旧数据）按 public 处理 */
export function rowVisibility(
  row: { visibility?: VisibilityValue | string | null }
): VisibilityValue {
  return row.visibility === "personal" ? "personal" : "public";
}

/**
 * 行级可读判定（详情接口防越权，与服务端 canRead 同一规则）：
 * admin 全量；public（含缺列降级/旧数据）全员可见；personal 仅创建人本人。
 * 他人 personal 条目建议返回 404（防探测）。
 */
export function canReadRow(
  user: VisibilityUser,
  row: { visibility?: VisibilityValue | string | null; owner_id?: number | string | null } | null | undefined
): boolean {
  if (!user || !row) return false;
  if (user.role === "admin") return true;
  if (rowVisibility(row) === "public") return true;
  const ownerId = row.owner_id === null || row.owner_id === undefined ? null : Number(row.owner_id);
  return ownerId !== null && ownerId === user.id;
}
