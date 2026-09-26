/** 知识库共享类型（KnowledgeManager / CategoryPanel 共用） */

export type DocRow = {
  id: number;
  title: string;
  category: string;
  tags: string[];
  pinned: number;
  created_by: string | null;
  source?: string;
  /** 可见性：personal | public（缺列按 public） */
  visibility?: string | null;
  /** 创建人 users.id */
  owner_id?: number | null;
  /** 创建人展示名（admin 后端 ownerNames 批量组装） */
  owner_name?: string | null;
  created_at: string;
  updated_at: string;
  excerpt: string;
};

export type CategoryRow = { id: number; name: string; count: number };
export type TagRow = { name: string; count: number };

/** 可见性筛选枚举（管理后台批量筛选与标记） */
export const VISIBILITY_OPTIONS: { label: string; value: "" | "personal" | "public" }[] = [
  { label: "全部", value: "" },
  { label: "个人", value: "personal" },
  { label: "通用", value: "public" },
];
