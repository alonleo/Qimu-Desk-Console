import { row, rows, exec, escapeLike, withColumnFallback, ensureVisibilityColumns, isBadFieldError } from "./db";
import type { SourceValue } from "./ai/artifacts";
import {
  memberScopeSql,
  normalizeVisibility,
  type VisibilityValue,
  type VisibilityUser,
} from "./visibility";

/**
 * 知识库核心：与 admin-platform 共享同一 MySQL docs / categories 表。
 * 检索策略与后端一致：LIKE 子串匹配（MySQL FULLTEXT 默认分词器不切中文，
 * 子串级检索对中文更可靠），摘要中的 <em> 高亮由本层 JS 生成
 * （KnowledgeView 的 Highlighted 组件负责安全渲染，不上 dangerouslySetInnerHTML）。
 */

export type DocRecord = {
  id: number;
  title: string;
  category: string;
  tags: string[];
  content: string;
  pinned: number;
  created_by: string | null;
  /** 来源标识：manual | file | ai（docs 无列时默认 manual） */
  source: SourceValue;
  /** 可见性：personal | public（旧库缺列降级时按 public 处理，§六.4） */
  visibility?: VisibilityValue | null;
  /** 创建人 users.id；NULL = 系统通用数据（docs 双轨：created_by 仅展示保留） */
  owner_id?: number | null;
  /** 创建人展示名（详情接口一次查 users 组装；列表可能缺省） */
  owner_name?: string | null;
  created_at: string;
  updated_at: string;
};

export type DocListItem = {
  id: number;
  title: string;
  category: string;
  tags: string[];
  pinned: number;
  created_by: string | null;
  /** 来源标识：manual | file | ai（docs 无列时默认 manual） */
  source: SourceValue;
  /** 可见性：personal | public（旧库缺列降级时按 public 处理，§六.4） */
  visibility?: VisibilityValue | null;
  /** 创建人 users.id；NULL = 系统通用数据 */
  owner_id?: number | null;
  created_at: string;
  updated_at: string;
  /** 列表摘要：搜索时含 <em> 高亮，否则取正文开头 */
  excerpt: string;
};

export type DocInput = {
  title: string;
  category: string;
  tags: string[];
  content: string;
};

type DocRow = Omit<DocRecord, "tags" | "source" | "visibility"> & {
  tags: string;
  source?: string | null;
  visibility?: string | null;
};

/** HTML 转义（生成高亮片段前先转义，避免注入/破坏布局） */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** 去掉常见 Markdown 标记，生成干净的摘要文本 */
function toPlain(content: string): string {
  return content
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*`~\[\]!]/g, " ")
    .replace(/[-*_]{3,}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function plainExcerpt(content: string, max = 140): string {
  const plain = toPlain(content);
  return plain.length > max ? plain.slice(0, max) + "…" : plain;
}

/** 摘要截窗 + 命中词 <em> 高亮（原始串定位后逐段转义，保证标签不被打断） */
function highlightExcerpt(content: string, kw: string, max = 140): string {
  const needle = kw.trim();
  const plain = toPlain(content);
  if (!needle) return plainExcerpt(plain, max);
  const lower = plain.toLowerCase();
  const nl = needle.toLowerCase();
  const idx = lower.indexOf(nl);
  if (idx === -1) return escapeHtml(plainExcerpt(plain, max));

  let start = Math.max(0, idx - Math.floor(max / 2));
  let end = Math.min(plain.length, start + max);
  if (end === plain.length) start = Math.max(0, end - max);
  const seg = plain.slice(start, end);
  const pre = start > 0 ? "…" : "";
  const post = end < plain.length ? "…" : "";

  let out = "";
  let pos = 0;
  const segLower = seg.toLowerCase();
  // 高亮窗口内所有命中（转义原文 + 包裹 <em>）
  for (let j = segLower.indexOf(nl); j !== -1; j = segLower.indexOf(nl, pos)) {
    out += escapeHtml(seg.slice(pos, j)) + "<em>" + escapeHtml(seg.slice(j, j + needle.length)) + "</em>";
    pos = j + needle.length;
  }
  out += escapeHtml(seg.slice(pos));
  return pre + out + post;
}

function parseTags(raw: string): string[] {
  return raw.split(",").map((t) => t.trim()).filter(Boolean);
}

function rowToRecord(rowData: DocRow): DocRecord {
  return {
    ...rowData,
    tags: parseTags(rowData.tags),
    source: (rowData.source ?? "manual") as SourceValue,
    // 可见性：缺列/NULL 降级按 public（§六.4 宁多见不误伤）
    visibility: rowData.visibility === "personal" ? "personal" : "public",
  };
}

/** SELECT 列（source + visibility 两代变体） */
const SELECT_COLS_WITH =
  "id, title, category, tags, content, pinned, created_by, source, visibility, owner_id, created_at, updated_at";
/** SELECT 列（无 source/visibility 列：迁移前降级） */
const SELECT_COLS_LEGACY =
  "id, title, category, tags, content, pinned, created_by, created_at, updated_at";

/** 新建文档时把新分类兜底进 categories 表（与后端 ensureCategory 行为一致） */
async function ensureCategory(name: string): Promise<void> {
  if (!name || !name.trim()) return;
  const found = await row("SELECT id FROM categories WHERE name = ?", [name.trim()]);
  if (!found) {
    await exec("INSERT INTO categories (name) VALUES (?)", [name.trim()]);
  }
}

/**
 * 列表查询：可选子串检索（q）、分类、标签过滤；置顶优先、时间倒序。
 * @param opts.user 当前用户：member 追加 scope（自己创建的 + 通用），admin 全量
 * @param opts.mine P1 筛选：'1' 仅我的；'public' 仅通用
 * 降级语义（§六.4）：缺列（1054）时改跑 legacy SQL 且不做任何可见性过滤。
 */
export async function listDocs(opts: {
  q?: string;
  category?: string;
  tag?: string;
  limit?: number;
  user?: { id: number; role: "admin" | "member" } | null;
  mine?: "1" | "public";
} = {}): Promise<DocListItem[]> {
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 500);
  const q = opts.q?.trim();
  const params: (string | number)[] = [];
  const conds: string[] = [];

  if (q) {
    const like = `%${escapeLike(q)}%`;
    conds.push("(title LIKE ? OR tags LIKE ? OR content LIKE ?)");
    params.push(like, like, like);
  }
  if (opts.category && opts.category !== "all") {
    conds.push("category = ?");
    params.push(opts.category);
  }
  if (opts.tag) {
    conds.push("FIND_IN_SET(?, tags) > 0");
    params.push(opts.tag);
  }
  if (opts.mine === "1" && opts.user) {
    conds.push("owner_id = ?");
    params.push(opts.user.id);
  } else if (opts.mine === "public") {
    conds.push("visibility = 'public'");
  } else {
    const scope = memberScopeSql(opts.user ?? null, "d");
    if (scope.clause) {
      conds.push(`(${scope.clause.replace(/^\s*AND\s+/, "")})`);
      params.push(...scope.params);
    }
  }
  // 带检索词时标题命中优先展示
  const order = q
    ? "pinned DESC, (CASE WHEN title LIKE ? THEN 0 ELSE 1 END), updated_at DESC, id DESC"
    : "pinned DESC, updated_at DESC, id DESC";
  if (q) params.push(`%${escapeLike(q)}%`);

  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  let all: DocRow[];
  try {
    all = await rows<DocRow>(
      `SELECT ${SELECT_COLS_WITH} FROM docs d ${where} ORDER BY ${order} LIMIT ?`,
      [...params, limit]
    );
  } catch (e) {
    if (isBadFieldError(e)) {
      // 未迁移旧库：降级不过滤（宁多见不误伤）
      all = await rows<DocRow>(
        `SELECT ${SELECT_COLS_LEGACY} FROM docs d ${where} ORDER BY ${order} LIMIT ?`,
        [...params, limit]
      );
    } else {
      throw e;
    }
  }
  return all.map((d) => ({
    ...rowToRecord(d),
    excerpt: q ? highlightExcerpt(d.content, q) : plainExcerpt(d.content),
  }));
}

export async function getDoc(id: number): Promise<DocRecord | null> {
  const arr = await withColumnFallback<DocRow>(
    `SELECT ${SELECT_COLS_WITH} FROM docs WHERE id = ?`,
    `SELECT ${SELECT_COLS_LEGACY} FROM docs WHERE id = ?`,
    [id]
  );
  const d = arr[0] ?? null;
  return d ? rowToRecord(d) : null;
}

/** 创建人展示名（详情一次查 users；用户不存在/未设置时回退 null） */
async function docOwnerNameOf(ownerId: number | null | undefined): Promise<string | null> {
  if (ownerId === null || ownerId === undefined) return null;
  const u = await row<{ display_name: string | null; username: string }>(
    "SELECT display_name, username FROM users WHERE id = ?",
    [ownerId]
  );
  if (!u) return null;
  return u.display_name && u.display_name.trim() ? u.display_name : u.username;
}

/** 详情（含 owner_name 组装；路由层负责 member 可读校验） */
export async function getDocDetail(id: number): Promise<DocRecord | null> {
  const doc = await getDoc(id);
  if (!doc) return null;
  return { ...doc, owner_name: await docOwnerNameOf(doc.owner_id) };
}

export async function createDoc(
  input: DocInput,
  username: string,
  opts?: { source?: SourceValue; ownerId?: number; visibility?: VisibilityValue }
): Promise<DocRecord> {
  const title = input.title;
  const category = input.category || "未分类";
  const tags = input.tags.join(",");
  const source = (opts?.source === "ai" || opts?.source === "file" ? opts.source : "manual") as SourceValue;
  const visibility = normalizeVisibility(opts?.visibility);
  const ownerId =
    typeof opts?.ownerId === "number" && Number.isInteger(opts.ownerId) ? opts.ownerId : null;

  let insertId: number;
  if (visibility) {
    // 创建接口注入 visibility/owner_id（服务端权威，不信任前端 owner_id）
    try {
      const info = await exec(
        `INSERT INTO docs (title, category, tags, content, created_by, source, visibility, owner_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [title, category, tags, input.content, username, source, visibility, ownerId]
      );
      insertId = info.insertId;
    } catch (e) {
      if (isBadFieldError(e)) {
        // 旧库缺列：自愈补列后重试；personal 语义在缺列库上会泄露隐私，必须报错而非静默降级
        const ensured = await ensureVisibilityColumns();
        if (ensured) {
          const info = await exec(
            `INSERT INTO docs (title, category, tags, content, created_by, source, visibility, owner_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [title, category, tags, input.content, username, source, visibility, ownerId]
          );
          insertId = info.insertId;
        } else if (visibility === "public") {
          const info = await exec(
            `INSERT INTO docs (title, category, tags, content, created_by, source)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [title, category, tags, input.content, username, source]
          );
          insertId = info.insertId;
        } else {
          throw new Error(
            "库结构未升级：docs 表缺少 visibility/owner_id 列且自动补列失败，请先启动一次管理后台完成迁移"
          );
        }
      } else {
        throw e;
      }
    }
  } else {
    // 未显式指定可见性（示例播种等）：沿用旧 INSERT，列默认 public/NULL 落对
    try {
      const info = await exec(
        `INSERT INTO docs (title, category, tags, content, created_by, source)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [title, category, tags, input.content, username, source]
      );
      insertId = info.insertId;
    } catch (e) {
      if (isBadFieldError(e)) {
        // 旧库尚无 source 列：退回不带 source 的 INSERT（来源由列默认 manual 兜底）
        const info = await exec(
          `INSERT INTO docs (title, category, tags, content, created_by)
           VALUES (?, ?, ?, ?, ?)`,
          [title, category, tags, input.content, username]
        );
        insertId = info.insertId;
      } else {
        throw e;
      }
    }
  }
  await ensureCategory(category);
  return (await getDocDetail(insertId)) as DocRecord;
}

export async function updateDoc(
  id: number,
  patch: Partial<DocInput> & { pinned?: boolean; visibility?: VisibilityValue },
): Promise<DocRecord | null> {
  const current = await getDoc(id);
  if (!current) return null;

  const title = patch.title ?? current.title;
  const category = patch.category ?? current.category;
  const tags = patch.tags ?? current.tags;
  const content = patch.content ?? current.content;
  const pinned = patch.pinned === undefined ? current.pinned : patch.pinned ? 1 : 0;
  const visibility = patch.visibility === "personal" || patch.visibility === "public" ? patch.visibility : undefined;

  if (visibility) {
    await exec(
      `UPDATE docs SET title = ?, category = ?, tags = ?, content = ?, pinned = ?, visibility = ?, updated_at = NOW()
       WHERE id = ?`,
      [title, category, tags.join(","), content, pinned, visibility, id]
    );
  } else {
    await exec(
      `UPDATE docs SET title = ?, category = ?, tags = ?, content = ?, pinned = ?, updated_at = NOW()
       WHERE id = ?`,
      [title, category, tags.join(","), content, pinned, id]
    );
  }
  if (category !== current.category) await ensureCategory(category);
  return getDoc(id);
}

export async function deleteDoc(id: number): Promise<boolean> {
  const info = await exec("DELETE FROM docs WHERE id = ?", [id]);
  return info.changes > 0;
}

/** 分类项（含文档数）。管理员可在工作台或管理台维护共享目录。 */
export type CategoryItem = { id: number; name: string; count: number };

/** 全部受管分类及当前用户可见的文档计数。 */
export async function listCategories(user: VisibilityUser = null): Promise<CategoryItem[]> {
  const scope = memberScopeSql(user, "d");
  const [visible, all] = await Promise.all([
    rows<{ name: string; count: number }>(`
      SELECT d.category AS name, COUNT(*) AS count
      FROM docs d
      WHERE 1 = 1 ${scope.clause}
      GROUP BY d.category
      ORDER BY d.category
    `, scope.params),
    rows<{ id: number; name: string }>("SELECT id, name FROM categories ORDER BY name"),
  ]);
  // 保留空分类供新建选择，同时补齐历史文档中尚未登记的分类。
  const counts = new Map(visible.map((c) => [c.name, Number(c.count)]));
  const managed = new Set(all.map((c) => c.name));
  return [
    ...all.map((c) => ({ ...c, count: counts.get(c.name) ?? 0 })),
    ...visible.filter((c) => !managed.has(c.name)).map((c, i) => ({ ...c, id: -i - 2, count: Number(c.count) })),
  ];
}

/** 标签及计数只统计当前用户可见的文档。 */
export async function listTags(user: VisibilityUser = null): Promise<{ name: string; count: number }[]> {
  const scope = memberScopeSql(user, "d");
  const [all, managed] = await Promise.all([
    rows<{ tags: string }>(`SELECT tags FROM docs d WHERE 1 = 1 ${scope.clause}`, scope.params),
    rows<{ name: string }>("SELECT name FROM knowledge_tags ORDER BY name"),
  ]);
  const counter = new Map<string, number>(managed.map((tag) => [tag.name, 0]));
  for (const r of all) {
    for (const t of new Set(parseTags(r.tags))) counter.set(t, (counter.get(t) ?? 0) + 1);
  }
  return [...counter.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** 首次进入时播种示例文档（幂等：仅在空表时执行） */
export async function ensureSeedDocs(): Promise<void> {
  const { c } = (await row("SELECT COUNT(*) AS c FROM docs")) as { c: number };
  if (c > 0) return;

  const seeds: DocInput[] = [
    {
      title: "工作台使用指南",
      category: "指南",
      tags: ["入门", "帮助"],
      content: `# 工作台使用指南

这是一个部署在服务器上的多人个人工作台，五大模块各司其职。

## 任务与项目

- **项目**：用彩色胶囊区分，点击可归档或删除
- **任务**：支持列表与看板双视图，看板按状态分四列（待办 / 进行中 / 等待 / 完成）
- 优先级排序：紧急 > 高 > 普通 > 低

## 技能中心

技能以 \`skills/<目录>/skill.yml\` 声明，支持三类执行器：

1. **shell**：本地命令，带超时保护
2. **http**：调用任意 HTTP 接口
3. **prompt**：渲染 Prompt 模板

## 工作流

\`workflows/*.yml\` 声明式编排，步骤间用 \`{{steps.<步骤id>.output}}\` 传递变量。
支持 shell / http / llm / template / skill 五类步骤，失败即停。

## 知识库

就是你正在看的这里——Markdown 文档沉淀，支持全文检索（子串匹配）。
试试在搜索框输入「检索」或「docker」。
`,
    },
    {
      title: "Markdown 写作速查",
      category: "参考",
      tags: ["Markdown", "写作"],
      content: `# Markdown 速查表

## 标题与强调

- \`# 一级标题\` 到 \`###### 六级标题\`
- **粗体** / *斜体* / \`行内代码\` / ~~删除线~~

## 列表

- 无序列表项
- 另一项

1. 有序列表
2. 第二项

## 链接与图片

[链接文字](https://example.com)
![图片描述](/image.png)

## 表格

| 语法 | 说明 |
| --- | --- |
| GFM | 表格、任务列表、自动链接 |
| LIKE | 知识库子串检索引擎 |

## 代码块

\`\`\`ts
function hello(name: string): string {
  return \`Hello, \${name}!\`;
}
\`\`\`

## 任务列表

- [x] 已完成
- [ ] 待办
`,
    },
    {
      title: "部署运维备忘",
      category: "运维",
      tags: ["部署", "docker", "mysql"],
      content: `# 部署运维备忘

## 架构

- **Next.js standalone** 构建产物跑在容器内 3000 端口
- **Caddy / 1Panel** 做反向代理，自动签发 HTTPS 证书
- **数据源**：工作台与后台共享同一 MySQL 库 \`qimu_platform\`，重建容器不丢数据

## 常用命令

\`\`\`bash
docker compose up -d --build   # 构建并启动
docker compose logs -f app      # 看应用日志
docker compose restart caddy    # 重启网关
\`\`\`

## 备份

数据库在 MySQL 的 \`qimu_platform\` 库，冷备份可用 \`mysqldump qimu_platform > backup.sql\`。

## 健康检查

- \`GET /api/health\` 无需登录即可探活
- 工作流 \`health-patrol\` 可定期自检各 API
`,
    },
  ];

  for (const s of seeds) await createDoc(s, "admin");
  // 示例第一条置顶，方便发现
  const first = await row<{ id: number }>("SELECT id FROM docs ORDER BY id LIMIT 1");
  if (first) await updateDoc(first.id, { pinned: true });
}
