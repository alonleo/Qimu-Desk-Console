"use client";

import { useMemo, useState } from "react";
import {
  App,
  Avatar,
  Button,
  Card,
  Col,
  Empty,
  Input,
  Popconfirm,
  Row,
  Select,
  Segmented,
  Space,
  Spin,
  Tag,
  Typography,
} from "antd";
import {
  ArrowLeftOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  PushpinFilled,
  ReadOutlined,
  SaveOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import type { DocListItem, DocRecord } from "@/core/knowledge";
import SourceTag from "@/components/SourceTag";
import VisibilityTag from "@/components/VisibilityTag";
import dynamic from "next/dynamic";

/** 知识库文档正文 Markdown（懒加载：react-markdown/remark 仅在使用时进入客户端 chunk） */
const DocMarkdown = dynamic(() => import("@/components/knowledge/DocMarkdownBody"), {
  ssr: false,
  loading: () => (
    <div style={{ color: "rgba(0,0,0,0.45)", fontSize: 13, padding: "12px 0" }}>加载文档渲染…</div>
  ),
});

const MODULE_COLOR = "#1677ff";

const CATEGORY_COLORS = ["#1677ff", "#0ea5e9", "#13c2c2", "#52c41a", "#fa8c16", "#eb2f96", "#f5222d", "#2f54eb"];
const TAG_COLORS = ["blue", "purple", "cyan", "green", "orange", "magenta", "geekblue", "gold"];

function categoryColor(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return CATEGORY_COLORS[h % CATEGORY_COLORS.length];
}

function tagColor(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 37 + ch.charCodeAt(0)) % 997;
  return TAG_COLORS[h % TAG_COLORS.length];
}

function gradient(color: string): string {
  return color;
}

/** 时间展示：MySQL 以本地时（Asia/Shanghai）存文本，直接按文本截取，不做时区换算 */
function fmtTime(s?: string | null): string {
  if (!s) return "-";
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(s);
  if (!m) return s;
  return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}`;
}

/** snippet 里 <em>…</em> 高亮标记解析渲染（不 dangerouslySetInnerHTML，避免注入） */
function Highlighted({ text }: { text: string }) {
  const parts = text.split(/(<em>[\s\S]*?<\/em>)/g);
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith("<em>") && p.endsWith("</em>")) {
          return (
            <mark key={i} style={{ background: "#e6f4ff", color: "#0958d9", padding: "0 2px", borderRadius: 3 }}>
              {p.slice(5, -6)}
            </mark>
          );
        }
        return <span key={i}>{p}</span>;
      })}
    </>
  );
}

type CategoryItem = { id: number; name: string; count: number };
type TagItem = { name: string; count: number };
type ViewMode = "list" | "detail" | "edit";

/** 解析标签输入：中文/英文逗号、分号、空格、换行均可分隔 */
function parseTags(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .split(/[,，;；\s\n]+/)
        .map((t) => t.trim())
        .filter(Boolean)
    )
  ).slice(0, 10);
}

export default function KnowledgeView({
  initialDocs,
  initialCategories,
  initialTags,
}: {
  initialDocs: DocListItem[];
  initialCategories: CategoryItem[];
  initialTags: TagItem[];
}) {
  const { message } = App.useApp();
  const [docs, setDocs] = useState<DocListItem[]>(initialDocs);
  const [categories, setCategories] = useState<CategoryItem[]>(initialCategories);
  const [keyword, setKeyword] = useState("");
  const [category, setCategory] = useState("all");
  const [loading, setLoading] = useState(false);

  // 视图状态：list 列表 / detail 阅读 / edit 编辑
  const [view, setView] = useState<ViewMode>("list");
  const [detail, setDetail] = useState<DocRecord | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // 编辑（全页视图，非弹窗）
  const [editingId, setEditingId] = useState<number | null>(null);
  const [eTitle, setETitle] = useState("");
  const [eCategory, setECategory] = useState<string | undefined>(undefined);
  const [eTagsRaw, setETagsRaw] = useState("");
  const [eContent, setEContent] = useState("");
  const [ePane, setEPane] = useState<"write" | "preview">("write");
  const [saving, setSaving] = useState(false);

  const totalCount = useMemo(() => categories.reduce((s, c) => s + c.count, 0), [categories]);
  const eTags = useMemo(() => parseTags(eTagsRaw), [eTagsRaw]);

  /** 统一刷新列表（带当前关键词与分类过滤） */
  async function refreshList(kw = keyword, cat = category) {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (kw.trim()) params.set("q", kw.trim());
      if (cat !== "all") params.set("category", cat);
      const res = await fetch(`/api/knowledge?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "加载失败");
      setDocs(data.docs || []);
      setCategories(data.categories || []);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function openDoc(id: number) {
    setDetailLoading(true);
    setDetail(null);
    setView("detail");
    try {
      const res = await fetch(`/api/knowledge/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "加载失败");
      setDetail(data.doc);
    } catch (e) {
      message.error((e as Error).message);
      setView("list");
    } finally {
      setDetailLoading(false);
    }
  }

  /** 进入全页编辑视图：doc 为空即新建 */
  function openEditor(doc?: DocRecord) {
    setEditingId(doc?.id ?? null);
    setETitle(doc?.title ?? "");
    setECategory(doc?.category || undefined);
    setETagsRaw(doc?.tags.join(" ") ?? "");
    setEContent(doc?.content ?? "");
    setEPane("write");
    setView("edit");
  }

  function backToList() {
    setView("list");
    setDetail(null);
    setDetailLoading(false);
  }

  async function saveDoc() {
    if (!eTitle.trim()) {
      message.warning("请输入文档标题");
      return;
    }
    setSaving(true);
    try {
      const body = JSON.stringify({
        title: eTitle.trim(),
        category: eCategory ?? "",
        tags: eTags,
        content: eContent,
      });
      const res = await fetch(editingId ? `/api/knowledge/${editingId}` : "/api/knowledge", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "保存失败");
      message.success(editingId ? "文档已更新" : "文档已创建");
      await refreshList();
      // 保存后回到阅读视图
      if (data.doc) {
        setDetail(data.doc);
        setView("detail");
      } else {
        backToList();
      }
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function togglePin(doc: DocRecord) {
    try {
      const res = await fetch(`/api/knowledge/${doc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned: !doc.pinned }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "操作失败");
      setDetail(data.doc);
      message.success(data.doc.pinned ? "已置顶" : "已取消置顶");
      await refreshList();
    } catch (e) {
      message.error((e as Error).message);
    }
  }

  async function removeDoc(doc: DocRecord) {
    try {
      const res = await fetch(`/api/knowledge/${doc.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "删除失败");
      message.success(`已删除「${doc.title}」`);
      backToList();
      await refreshList();
    } catch (e) {
      message.error((e as Error).message);
    }
  }

  /** 固定返回条：阅读/编辑共用，吸附在 sticky Header 下方 */
  function TopBar({ extra }: { extra?: React.ReactNode }) {
    return (
      <div
        style={{
          position: "sticky",
          top: 64, // 吸附在 sticky Header（64px）下方
          zIndex: 9,
          margin: "0 -8px 4px",
          padding: "6px 8px",
          background: "#f5f6fa", // 与 Content 背景一致，避免正文透出
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <Button type="text" icon={<ArrowLeftOutlined />} style={{ paddingLeft: 0 }} onClick={backToList}>
          返回列表
        </Button>
        <span style={{ flex: 1 }} />
        {extra}
      </div>
    );
  }

  // ============ 编辑视图（全页，与主界面同布局） ============
  if (view === "edit") {
    return (
      <div style={{ maxWidth: 960, margin: "0 auto", width: "100%" }}>
        <TopBar
          extra={
            <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={saveDoc}>
              {editingId ? "保存" : "创建"}
            </Button>
          }
        />
        <Card style={{ borderRadius: 8 }} styles={{ body: { padding: "24px 32px" } }}>
          {/* 标题 / 分类 / 标签：直接放在正文上方 */}
          <Input
            size="large"
            variant="borderless"
            placeholder="输入文档标题…"
            value={eTitle}
            maxLength={200}
            onChange={(e) => setETitle(e.target.value)}
            style={{ fontSize: 22, fontWeight: 600, padding: "0 0 10px", borderBottom: "1px solid #f0f0f0" }}
          />
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", padding: "12px 0" }}>
            <Select
              placeholder="分类"
              allowClear
              showSearch
              optionFilterProp="label"
              value={eCategory}
              onChange={setECategory}
              options={categories.map((c) => ({ value: c.name, label: c.name }))}
              notFoundContent="暂无分类，请先在管理后台创建分类"
              style={{ minWidth: 160 }}
            />
            <Select
              mode="tags"
              placeholder="标签（回车确认，最多 10 个）"
              value={eTags}
              onChange={(vals) => setETagsRaw(vals.join(" "))}
              open={false}
              suffixIcon={null}
              tokenSeparators={[",", "，", " ", "；", ";"]}
              style={{ flex: 1, minWidth: 240 }}
            />
          </div>

          {/* 正文：编写 / 实时预览 */}
          <Segmented
            value={ePane}
            onChange={(v) => setEPane(v as "write" | "preview")}
            options={[
              { label: "编写", value: "write" },
              { label: "预览", value: "preview" },
            ]}
            style={{ marginBottom: 10 }}
          />
          {ePane === "write" ? (
            <Input.TextArea
              value={eContent}
              onChange={(e) => setEContent(e.target.value)}
              placeholder={"# 标题\n\n支持 GFM：表格、任务列表、代码块…"}
              autoSize={{ minRows: 20, maxRows: 40 }}
              variant="borderless"
              style={{
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: 13.5,
                lineHeight: 1.7,
                padding: 0,
              }}
            />
          ) : (
            <div style={{ minHeight: 360, paddingTop: 4 }}>
              <DocMarkdown content={eContent} />
            </div>
          )}
        </Card>
      </div>
    );
  }

  // ============ 阅读视图（Markdown 实时渲染） ============
  if (view === "detail") {
    return (
      <div style={{ maxWidth: 860, margin: "0 auto", width: "100%" }}>
        <TopBar />
        {/* 操作条：编辑、置顶、删除，放置在返回列表下一行 */}
        <div
          style={{
            display: "flex",
            gap: 8,
            marginBottom: 16,
            alignItems: "center",
          }}
        >
          <Button icon={<EditOutlined />} onClick={() => detail && openEditor(detail)} disabled={!detail}>
            编辑
          </Button>
          <Button
            icon={<PushpinFilled />}
            onClick={() => detail && togglePin(detail)}
            type={detail?.pinned ? "primary" : "default"}
            disabled={!detail}
          >
            {detail?.pinned ? "取消置顶" : "置顶"}
          </Button>
          <span style={{ flex: 1 }} />
          <Popconfirm
            title="删除这篇文档？"
            description="删除后不可恢复，FTS 索引将同步清理。"
            okText="删除"
            okButtonProps={{ danger: true }}
            onConfirm={() => detail && removeDoc(detail)}
          >
            <Button danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </div>
        {detailLoading ? (
          <Card style={{ borderRadius: 8, minHeight: 360, display: "grid", placeItems: "center" }}>
            <Spin size="large" />
          </Card>
        ) : detail ? (
          <Card style={{ borderRadius: 8 }} styles={{ body: { padding: "32px 40px" } }}>
            {/* 标题 */}
            <Typography.Title level={3} style={{ marginTop: 0, marginBottom: 8 }}>
              {detail.title}
              {!!detail.pinned && <PushpinFilled style={{ color: "#faad14", fontSize: 20, marginLeft: 10 }} />}
            </Typography.Title>

            {/* 元信息 */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 6, alignItems: "center" }}>
              <Tag color={categoryColor(detail.category)}>{detail.category}</Tag>
              <VisibilityTag value={detail.visibility} />
              <SourceTag source={detail.source} />
              {detail.tags.map((t) => (
                <Tag key={t} color={tagColor(t)}>
                  {t}
                </Tag>
              ))}
            </div>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {detail.created_by || "-"} 创建于 {fmtTime(detail.created_at)} · 更新于 {fmtTime(detail.updated_at)}
            </Typography.Text>

            {/* 正文：Markdown 实时渲染 */}
            <div style={{ marginTop: 24 }}>
              <DocMarkdown content={detail.content} />
            </div>
          </Card>
        ) : null}
      </div>
    );
  }

  // ============ 列表视图（原主界面） ============
  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* 页头 */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <Space>
          <Avatar shape="square" size={36} style={{ background: "#eaf0f6", color: "#345d88", fontSize: 18 }}>
            <ReadOutlined />
          </Avatar>
          <div>
            <Typography.Title level={4} style={{ margin: 0 }}>
              知识库
            </Typography.Title>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              搜索、整理和查阅工作资料 · {totalCount} 篇文档
            </Typography.Text>
          </div>
        </Space>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => openEditor()} size="large">
          新建文档
        </Button>
      </div>

      {/* 搜索与分类筛选 */}
      <div
        style={{
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <Input.Search
          placeholder="搜索标题、标签、正文…（支持中文，多个词按空格分隔）"
          allowClear
          enterButton={<SearchOutlined />}
          style={{ maxWidth: 420, flex: "1 1 260px" }}
          onSearch={(v) => {
            setKeyword(v);
            refreshList(v, category);
          }}
        />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {[{ name: "all", count: totalCount }, ...categories].map((c) => {
            const active = category === c.name;
            const color = c.name === "all" ? MODULE_COLOR : categoryColor(c.name);
            return (
              <button
                key={c.name}
                onClick={() => {
                  setCategory(c.name);
                  refreshList(keyword, c.name);
                }}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "5px 14px",
                  borderRadius: 999,
                  cursor: "pointer",
                  border: `1px solid ${active ? color : "#e4e7ec"}`,
                  background: active ? color : "#fff",
                  color: active ? "#fff" : "#595959",
                  fontSize: 13,
                  fontWeight: active ? 600 : 400,
                  transition: "all .2s",
                }}
              >
                {c.name === "all" ? "全部" : c.name}
                <span style={{ opacity: 0.75, fontSize: 12 }}>{c.count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 文档卡片 */}
      <Spin spinning={loading}>
        {docs.length === 0 ? (
          <Card style={{ borderRadius: 8 }}>
            <Empty
              description={
                keyword
                  ? `没有匹配「${keyword}」的文档，换个关键词试试`
                  : "知识库还是空的——点右上角「新建文档」写下第一篇"
              }
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
          </Card>
        ) : (
          <Row gutter={[16, 16]} align="stretch">
            {docs.map((d) => {
              const color = categoryColor(d.category);
              return (
                <Col xs={24} sm={12} lg={8} key={d.id} style={{ display: "flex" }}>
                  <Card
                    hoverable
                    style={{ height: "100%", borderRadius: 8, borderColor: "#e2e7ec" }}
                    onClick={() => openDoc(d.id)}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontWeight: 600,
                            fontSize: 15,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                          }}
                        >
                          {!!d.pinned && (
                            <PushpinFilled style={{ color: "#faad14", fontSize: 13, flexShrink: 0 }} />
                          )}
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{d.title}</span>
                        </div>
                        <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                          {fmtTime(d.updated_at)} · {d.created_by || "-"}
                        </Typography.Text>
                      </div>
                      <Space
                        size={4}
                        style={{ flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end", maxWidth: "55%" }}
                      >
                        <Tag color={color} style={{ margin: 0 }}>
                          {d.category}
                        </Tag>
                        <VisibilityTag value={d.visibility} style={{ margin: 0 }} />
                        <SourceTag source={d.source} />
                      </Space>
                    </div>
                    <p
                      style={{
                        margin: "10px 0 0",
                        fontSize: 12,
                        color: "#595959",
                        height: 36,
                        overflow: "hidden",
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                      }}
                    >
                      {d.excerpt ? <Highlighted text={d.excerpt} /> : "（空文档）"}
                    </p>
                    {d.tags.length > 0 && (
                      <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {d.tags.map((t) => (
                          <Tag key={t} color={tagColor(t)} style={{ margin: 0, fontSize: 11 }}>
                            {t}
                          </Tag>
                        ))}
                      </div>
                    )}
                  </Card>
                </Col>
              );
            })}
          </Row>
        )}
      </Spin>
    </div>
  );
}
