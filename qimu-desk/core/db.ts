import mysql from "mysql2/promise";

/**
 * 数据底座（统一后的 MySQL 连接层）
 *
 * 背景：与 admin-platform（Spring Boot 后端）彻底统一后，工作台不再使用
 * better-sqlite3，而是直连同一个 MySQL 库 `qimu_platform`。
 * - 表结构由后端 schema.sql 统一创建，本模块【不建表、不迁移】；
 * - mysql2 连接池懒连接：import 时不会真正连库（next build / 仅类型检查安全）；
 * - DATETIME 一律以字符串 "YYYY-MM-DD HH:MM:SS" 读出（dateStrings），
 *   与旧 SQLite 的文本时间戳形态一致，业务代码无需额外适配；
 * - 统一提供 rows / row / exec 三个异步辅助 + withTransaction 事务封装。
 *
 * 环境变量：DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME
 * 本地开发默认 root + 空密码（与 admin-backend application.yml 对齐）；
 * Docker 部署通过环境变量注入（指向 compose 内 mysql 服务）。
 */

const pool = mysql.createPool({
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "qimu_platform",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  connectTimeout: 10_000,
  charset: "utf8mb4",
  // DATETIME 直接返回字符串，形态与 SQLite 时代一致，避免 JS Date 干扰
  dateStrings: true,
  decimalNumbers: true,
  // 列名保持数据库原样（snake_case），与既有代码的字段约定一致
  namedPlaceholders: false,
});

export type SqlParam = string | number | boolean | null | Date | Buffer;
export type SqlParams = SqlParam[] | undefined;

/** 执行 SELECT 等，返回行数组（无行时为空数组） */
export async function rows<T = Record<string, unknown>>(
  sql: string,
  params: SqlParams = undefined
): Promise<T[]> {
  const [result] = await pool.query(sql, params);
  return result as T[];
}

/** 执行 SELECT，返回首行（无行时为 null） */
export async function row<T = Record<string, unknown>>(
  sql: string,
  params: SqlParams = undefined
): Promise<T | null> {
  const [result] = await pool.query(sql, params);
  const arr = result as T[];
  return arr.length > 0 ? arr[0] : null;
}

/** 执行写操作（INSERT / UPDATE / DELETE），返回 { changes, insertId } */
export async function exec(
  sql: string,
  params: SqlParams = undefined
): Promise<{ changes: number; insertId: number }> {
  const [result] = await pool.query<mysql.ResultSetHeader>(sql, params);
  return { changes: result.affectedRows, insertId: result.insertId };
}

/** 事务内可用查询器（与连接绑定，保证同事务） */
export type Tx = {
  rows: <T = Record<string, unknown>>(sql: string, params?: SqlParams) => Promise<T[]>;
  row: <T = Record<string, unknown>>(sql: string, params?: SqlParams) => Promise<T | null>;
  exec: (sql: string, params?: SqlParams) => Promise<{ changes: number; insertId: number }>;
};

/** 在单连接事务中执行 fn，成功 commit / 异常 rollback 后释放连接 */
export async function withTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const conn = await pool.getConnection();
  const tx: Tx = {
    rows: async <R,>(sql: string, params?: SqlParams): Promise<R[]> => {
      const [r] = await conn.query(sql, params);
      return r as R[];
    },
    row: async <R,>(sql: string, params?: SqlParams): Promise<R | null> => {
      const [r] = await conn.query(sql, params);
      const arr = r as R[];
      return arr.length > 0 ? (arr[0] as R) : null;
    },
    exec: async (sql: string, params?: SqlParams) => {
      const [r] = await conn.query<mysql.ResultSetHeader>(sql, params);
      return { changes: r.affectedRows, insertId: r.insertId };
    },
  };
  try {
    await conn.beginTransaction();
    const out = await fn(tx);
    await conn.commit();
    return out;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

/** 把 LIKE 通配符转义为字面量（配合默认 ESCAPE '\\'） */
export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, "\\$&");
}

/** 统一本地时间字符串（MySQL DATETIME 直接可用），等价于 SQL 端 NOW() */
export function nowString(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// —— 列级降级与幂等 DDL（AI 产物「创建即入库」source 列） ——

/** MySQL 错误：字段不存在（ER_BAD_FIELD_ERROR / 1054）→ SELECT 缺列降级依据 */
export function isBadFieldError(e: unknown): boolean {
  const err = e as { code?: string; errno?: number } | null;
  return !!err && (err.errno === 1054 || err.code === "ER_BAD_FIELD_ERROR");
}

/** MySQL 错误：唯一键冲突（ER_DUP_ENTRY / 1062）→ name 撞库转 duplicate */
export function isDuplicateKeyError(e: unknown): boolean {
  const err = e as { code?: string; errno?: number } | null;
  return !!err && (err.errno === 1062 || err.code === "ER_DUP_ENTRY");
}

/**
 * 双 SQL 变体查询：先执行带 source 列的 sqlWith；若库尚未迁移（缺 source 列，
 * 报 ER_BAD_FIELD_ERROR/1054）自动改跑不带 source 列的 sqlLegacy。
 * 返回形态与 rows<T>() 一致（行数组）；其余错误原样抛出。
 */
export async function withColumnFallback<T>(
  sqlWith: string,
  sqlLegacy: string,
  params: SqlParams = undefined
): Promise<T[]> {
  try {
    return await rows<T>(sqlWith, params);
  } catch (e) {
    if (isBadFieldError(e)) {
      return rows<T>(sqlLegacy, params);
    }
    throw e;
  }
}

/** ensureSourceColumns 进程级 promise 缓存：整个进程只真正探测/补列一次 */
let sourceColumnsEnsured: Promise<boolean> | null = null;

/**
 * 幂等补齐 skills / workflows / docs 三表的 source 列（与 admin 后端
 * SourceColumnMigrator 同语义，本地只跑 Next 不跑 admin 时兜底）。
 * - information_schema 检查缺列后才 ALTER，重复调用无副作用；
 * - 任何一步失败（如 DDL 权限不足）都吞掉并返回 false，不抛错阻断业务；
 * - 模块级 promise 缓存，每进程只执行一次。
 */
export function ensureSourceColumns(): Promise<boolean> {
  if (!sourceColumnsEnsured) {
    sourceColumnsEnsured = runEnsureSourceColumns();
  }
  return sourceColumnsEnsured;
}

async function runEnsureSourceColumns(): Promise<boolean> {
  const database = process.env.DB_NAME || "qimu_platform";
  const tables: { name: string; after: string }[] = [
    { name: "skills", after: "config" },
    { name: "workflows", after: "definition" },
    { name: "docs", after: "created_by" },
  ];
  try {
    for (const t of tables) {
      const found = await row<{ c: number }>(
        `SELECT COUNT(*) AS c FROM information_schema.columns
         WHERE table_schema = ? AND table_name = ? AND column_name = 'source'`,
        [database, t.name]
      );
      if (!found || found.c === 0) {
        await exec(
          `ALTER TABLE \`${t.name}\` ADD COLUMN source VARCHAR(16) NOT NULL DEFAULT 'manual' AFTER \`${t.after}\``
        );
      }
    }
    return true;
  } catch {
    // 权限不足 / 表不存在 / 连接失败：降级路径由 withColumnFallback 兜底，不抛错
    return false;
  }
}

/** ensureVisibilityColumns 进程级 promise 缓存：整个进程只真正探测/补列一次 */
let visibilityColumnsEnsured: Promise<boolean> | null = null;

/**
 * 幂等补齐五表（skills / workflows / tasks / projects / docs）的可见性两列
 * visibility + owner_id（与 admin 后端 VisibilityColumnMigrator 同语义，
 * 本地只跑 Next 不跑 admin 时的兜底，ARCHITECTURE §1.2 L3）。
 * - information_schema 检查缺列后才 ALTER，重复调用无副作用；
 * - 任何一步失败（如 DDL 权限不足）都吞掉并返回 false，不抛错阻断业务；
 * - 模块级 promise 缓存，每进程只执行一次。
 */
export function ensureVisibilityColumns(): Promise<boolean> {
  if (!visibilityColumnsEnsured) {
    visibilityColumnsEnsured = runEnsureVisibilityColumns();
  }
  return visibilityColumnsEnsured;
}

async function runEnsureVisibilityColumns(): Promise<boolean> {
  const database = process.env.DB_NAME || "qimu_platform";
  // after 落点与 schema.sql 一致（skills/workflows/docs 在 source 后、tasks 在 completed_at 后、projects 在 status 后）
  const tables: { name: string; after: string }[] = [
    { name: "skills", after: "source" },
    { name: "workflows", after: "source" },
    { name: "tasks", after: "completed_at" },
    { name: "projects", after: "status" },
    { name: "docs", after: "source" },
  ];
  const columns: { name: string; ddl: string }[] = [
    {
      name: "visibility",
      ddl: "visibility VARCHAR(16) NOT NULL DEFAULT 'public' COMMENT '可见性：personal=个人 public=通用'",
    },
    {
      name: "owner_id",
      ddl: "owner_id BIGINT NULL DEFAULT NULL COMMENT '创建人 users.id；NULL 视同系统通用数据'",
    },
  ];
  try {
    for (const t of tables) {
      for (const col of columns) {
        const found = await row<{ c: number }>(
          `SELECT COUNT(*) AS c FROM information_schema.columns
           WHERE table_schema = ? AND table_name = ? AND column_name = ?`,
          [database, t.name, col.name]
        );
        if (!found || found.c === 0) {
          await exec(
            `ALTER TABLE \`${t.name}\` ADD COLUMN ${col.ddl} AFTER \`${t.after}\``
          );
        }
      }
    }
    return true;
  } catch {
    // 权限不足 / 表不存在 / 连接失败：降级路径由调用方兜底（读不过滤、写回退旧列 INSERT），不抛错
    return false;
  }
}

export default pool;
