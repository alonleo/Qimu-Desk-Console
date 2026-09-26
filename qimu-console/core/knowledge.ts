/**
 * 知识库类型定义（纯类型，无副作用）。
 * 供前端组件使用；数据由 Spring Boot 后端提供。
 */

export type DocRecord = {
  id: number;
  title: string;
  category: string;
  tags: string[];
  content: string;
  pinned: number;
  created_by: string | null;
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
  created_at: string;
  updated_at: string;
  /** 列表摘要：搜索时来自全文检索片段，否则取正文开头 */
  excerpt: string;
};

export type DocInput = {
  title: string;
  category: string;
  tags: string[];
  content: string;
};

export type CategoryItem = { id: number; name: string; count: number };

export type CategoryResult =
  | { ok: true; category: { id: number; name: string } }
  | { ok: false; error: string };
