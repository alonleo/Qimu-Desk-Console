"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, App, Button, Empty, Input, Pagination, Popconfirm, Segmented, Select, Spin, Tag } from "antd";
import { ArrowLeftOutlined, AppstoreOutlined, DeleteOutlined, DownloadOutlined, EditOutlined, FileTextOutlined, FolderOutlined, PlusOutlined, PushpinFilled, ReadOutlined, ReloadOutlined, SaveOutlined, SearchOutlined, UnorderedListOutlined } from "@ant-design/icons";
import dynamic from "next/dynamic";
import type { DocListItem, DocRecord } from "@/core/knowledge";
import { canEditRow, defaultVisibility, type VisibilityUser, type VisibilityValue } from "@/core/visibility";
import SourceTag from "@/components/SourceTag";
import VisibilityTag from "@/components/VisibilityTag";
import VisibilitySelect from "@/components/VisibilitySelect";
import styles from "./knowledge.module.css";

const DocMarkdown = dynamic(() => import("./DocMarkdownBody"), { ssr: false, loading: () => <p>正在加载正文…</p> });
type CategoryItem = { id: number; name: string; count: number };
type TagItem = { name: string; count: number };
type Filters = { q: string; category: string; tag: string; mine: string };
type Draft = { title: string; category: string; tags: string[]; content: string; visibility: VisibilityValue };
const emptyFilters: Filters = { q: "", category: "all", tag: "", mine: "all" };
const dateLabel = (s: string) => s.replace("T", " ").slice(0, 16);
const decode = (s: string) => s.replace(/&(amp|lt|gt|quot|#39);/g, (_, key: string) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" })[key]!);
function Excerpt({ text, searched }: { text: string; searched: boolean }) {
  if (!searched) return <>{text}</>;
  return <>{text.split(/(<em>[\s\S]*?<\/em>)/g).map((part, i) => part.startsWith("<em>") && part.endsWith("</em>") ? <mark key={i}>{decode(part.slice(4, -5))}</mark> : <span key={i}>{decode(part)}</span>)}</>;
}

export default function KnowledgeView({ initialDocs, initialCategories, initialTags, user }: {
  initialDocs: DocListItem[]; initialCategories: CategoryItem[]; initialTags: TagItem[]; user: VisibilityUser;
}) {
  const { message, modal } = App.useApp();
  const [docs, setDocs] = useState(initialDocs);
  const [categories, setCategories] = useState(initialCategories);
  const [tags, setTags] = useState(initialTags);
  const [filters, setFilters] = useState(emptyFilters);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [view, setView] = useState<"list" | "detail" | "edit">("list");
  const [detail, setDetail] = useState<DocRecord | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft>({ title: "", category: "未分类", tags: [], content: "", visibility: defaultVisibility(user) });
  const [baseline, setBaseline] = useState("");
  const [pane, setPane] = useState("split");
  const [saving, setSaving] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [layout, setLayout] = useState("list");
  const [sort, setSort] = useState("updated");
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [page, setPage] = useState(1);
  const requestId = useRef(0);
  const detailRequest = useRef(0);
  const dirty = view === "edit" && JSON.stringify(draft) !== baseline;
  const total = categories.reduce((sum, c) => sum + Number(c.count), 0);

  const refresh = useCallback(async (active: Filters) => {
    const seq = ++requestId.current;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ limit: "500" });
      if (active.q) params.set("q", active.q);
      if (active.category !== "all") params.set("category", active.category);
      if (active.tag) params.set("tag", active.tag);
      if (active.mine !== "all") params.set("mine", active.mine);
      const res = await fetch(`/api/knowledge?${params}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "加载失败");
      if (seq !== requestId.current) return;
      setDocs(data.docs); setCategories(data.categories); setTags(data.tags);
    } catch (e) {
      if (seq === requestId.current) setError((e as Error).message);
    } finally {
      if (seq === requestId.current) setLoading(false);
    }
  }, []);
  useEffect(() => { void refresh(filters); return () => { requestId.current++; }; }, [filters, refresh]);
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const onLink = (event: MouseEvent) => {
      const anchor = (event.target as Element).closest?.("a[href]");
      if (anchor && !anchor.getAttribute("href")?.startsWith("#") && !window.confirm("文档尚未保存，确定离开并放弃修改？")) {
        event.preventDefault(); event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", onLink, true);
    return () => { window.removeEventListener("beforeunload", beforeUnload); document.removeEventListener("click", onLink, true); };
  }, [dirty]);

  function navigate(action: () => void) {
    if (saving || mutating) return;
    if (dirty) modal.confirm({ title: "放弃未保存的修改？", content: "离开编辑器后，本次修改将丢失。", okText: "放弃修改", cancelText: "继续编辑", onOk: action });
    else action();
  }
  function filter(patch: Partial<Filters>) {
    navigate(() => { detailRequest.current++; setView("list"); setPage(1); setFilters((old) => ({ ...old, ...patch })); });
  }
  function back() { navigate(() => { detailRequest.current++; setView("list"); }); }
  async function openDoc(id: number) {
    const seq = ++detailRequest.current;
    setSelectedId(id); setDetail(null); setDetailError(""); setDetailLoading(true); setView("detail");
    try {
      const res = await fetch(`/api/knowledge/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "文档加载失败");
      if (seq === detailRequest.current) setDetail(data.doc);
    } catch (e) { if (seq === detailRequest.current) setDetailError((e as Error).message); }
    finally { if (seq === detailRequest.current) setDetailLoading(false); }
  }
  function edit(doc?: DocRecord) {
    navigate(() => {
      detailRequest.current++;
      setDetailLoading(false); setDetailError("");
      const next: Draft = { title: doc?.title ?? "", category: doc?.category ?? (filters.category === "all" ? "未分类" : filters.category), tags: doc?.tags ?? [], content: doc?.content ?? "", visibility: doc?.visibility ?? defaultVisibility(user) };
      setEditingId(doc?.id ?? null); setDraft(next); setBaseline(JSON.stringify(next)); setPane("split"); setView("edit");
    });
  }
  async function save() {
    if (saving) return;
    if (!draft.title.trim()) { message.warning("请输入文档标题"); return; }
    setSaving(true);
    try {
      const res = await fetch(editingId ? `/api/knowledge/${editingId}` : "/api/knowledge", { method: editingId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...draft, title: draft.title.trim() }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "保存失败");
      setBaseline(JSON.stringify(draft)); setDetail(data.doc); setSelectedId(data.doc.id); setView("detail");
      message.success(editingId ? "文档已更新" : "文档已创建"); void refresh(filters);
    } catch (e) { message.error((e as Error).message); }
    finally { setSaving(false); }
  }
  async function mutate(remove = false) {
    if (!detail || mutating) return;
    setMutating(true);
    try {
      const res = await fetch(`/api/knowledge/${detail.id}`, { method: remove ? "DELETE" : "PATCH", headers: { "Content-Type": "application/json" }, ...(remove ? {} : { body: JSON.stringify({ pinned: !detail.pinned }) }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "操作失败");
      if (remove) { setDetail(null); setView("list"); message.success("文档已删除"); }
      else { setDetail(data.doc); message.success(data.doc.pinned ? "文档已置顶" : "已取消置顶"); }
      void refresh(filters);
    } catch (e) { message.error((e as Error).message); }
    finally { setMutating(false); }
  }
  function download() {
    if (!detail) return;
    const url = URL.createObjectURL(new Blob([detail.content], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `${detail.title.replace(/[\\/:*?"<>|]/g, "_")}.md`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const ordered = useMemo(() => [...docs].filter((doc) => !pinnedOnly || doc.pinned).sort((a, b) => b.pinned - a.pinned || (sort === "title" ? a.title.localeCompare(b.title, "zh-CN") : (sort === "created" ? b.created_at.localeCompare(a.created_at) : b.updated_at.localeCompare(a.updated_at)))), [docs, pinnedOnly, sort]);
  const currentPage = Math.min(page, Math.max(1, Math.ceil(ordered.length / 12)));
  const hasFilters = filters.q || filters.category !== "all" || filters.tag || filters.mine !== "all" || pinnedOnly;
  const writable = canEditRow(user, detail);
  const patchDraft = (patch: Partial<Draft>) => setDraft((old) => ({ ...old, ...patch }));

  return <section className={styles.root}>
    <header className={styles.header}>
      <div className={styles.heading}><span className={styles.brandIcon}><ReadOutlined /></span><div><h1>知识库</h1><p>把工作经验，整理成随时可用的知识。</p></div></div>
      <Button type="primary" icon={<PlusOutlined />} onClick={() => edit()} disabled={saving || mutating}>新建文档</Button>
    </header>
    <div className={styles.workspace}>
      <aside className={styles.sidebar} aria-label="知识库导航">
        <div className={styles.library}><ReadOutlined /><strong>文档空间</strong><span>{total} 篇</span></div>
        <div className={styles.sectionLabel}>浏览分类</div>
        <nav className={styles.categories}>
          {[{ id: -1, name: "all", count: total }, ...categories].map((item) => <button key={item.id} className={`${styles.navItem} ${filters.category === item.name ? styles.active : ""}`} aria-current={filters.category === item.name ? "true" : undefined} onClick={() => filter({ category: item.name })}><FolderOutlined /><span>{item.name === "all" ? "全部文档" : item.name}</span><small>{item.count}</small></button>)}
        </nav>
        <div className={styles.sectionLabel}>标签筛选</div>
        <Select aria-label="按标签筛选" placeholder="选择或搜索标签" showSearch optionFilterProp="label" allowClear value={filters.tag || undefined} onChange={(tag) => filter({ tag: tag ?? "" })} options={tags.map((t) => ({ value: t.name, label: `${t.name} (${t.count})` }))} className={styles.tagSelect} />
        <div className={styles.sidebarNote}><FileTextOutlined /><p>支持 Markdown 写作<br />分类由管理后台统一维护</p></div>
      </aside>
      <main className={styles.main}>
        {view === "list" ? <>
          <div className={styles.listHeader}><div><h2>{filters.category === "all" ? "全部文档" : filters.category}</h2><p>{loading ? "正在查找文档…" : `当前显示 ${ordered.length} 篇文档`}{pinnedOnly ? " · 仅看置顶" : " · 置顶优先"}</p></div><Button icon={<ReloadOutlined />} aria-label="刷新文档" onClick={() => refresh(filters)} loading={loading} /></div>
          <div className={styles.toolbar}>
            <Input.Search aria-label="搜索知识库" placeholder="搜索标题、标签或正文" value={search} onChange={(e) => setSearch(e.target.value)} allowClear onClear={() => filter({ q: "" })} onSearch={(q) => filter({ q: q.trim() })} enterButton={<SearchOutlined />} className={styles.search} />
            <Select aria-label="文档可见范围" value={filters.mine} onChange={(mine) => filter({ mine })} options={[{ label: "全部可见", value: "all" }, { label: "我创建的", value: "1" }, { label: "通用文档", value: "public" }]} />
            <Select aria-label="排序方式" value={sort} onChange={(v) => { setSort(v); setPage(1); }} options={[{ label: "最近更新", value: "updated" }, { label: "最近创建", value: "created" }, { label: "标题排序", value: "title" }]} />
            <Button icon={<PushpinFilled />} type={pinnedOnly ? "primary" : "default"} aria-pressed={pinnedOnly} onClick={() => { setPinnedOnly(!pinnedOnly); setPage(1); }}>置顶</Button>
            <Segmented aria-label="显示方式" value={layout} onChange={(v) => setLayout(String(v))} options={[{ value: "list", icon: <UnorderedListOutlined />, label: "列表" }, { value: "grid", icon: <AppstoreOutlined />, label: "卡片" }]} />
          </div>
          {hasFilters && <div className={styles.filterSummary}><span>当前筛选</span>{filters.q && <Tag>关键词：{filters.q}</Tag>}{filters.tag && <Tag>标签：{filters.tag}</Tag>}{filters.mine !== "all" && <Tag>{filters.mine === "1" ? "我创建的" : "通用文档"}</Tag>}<Button type="link" size="small" onClick={() => { setSearch(""); setPinnedOnly(false); filter(emptyFilters); }}>清除筛选</Button></div>}
          {error ? <Alert type="error" showIcon title="文档加载失败" description={error} action={<Button onClick={() => refresh(filters)}>重试</Button>} /> : <Spin spinning={loading}>
            {ordered.length ? <div className={`${styles.documents} ${layout === "grid" ? styles.grid : ""}`}>
              {ordered.slice((currentPage - 1) * 12, currentPage * 12).map((doc) => <button className={styles.document} key={doc.id} onClick={() => openDoc(doc.id)}>
                <span className={styles.fileIcon}><FileTextOutlined /></span>
                <div className={styles.docBody}><div className={styles.docTitle}>{!!doc.pinned && <PushpinFilled className={styles.pin} />}<h3>{doc.title}</h3></div><p className={styles.excerpt}><Excerpt text={doc.excerpt || "暂无正文，打开文档查看详情"} searched={!!filters.q} /></p><div className={styles.docTags}><Tag>{doc.category}</Tag><VisibilityTag value={doc.visibility} /><SourceTag source={doc.source} />{doc.tags.slice(0, 3).map((tag) => <span key={tag}>#{tag}</span>)}{doc.tags.length > 3 && <span>+{doc.tags.length - 3}</span>}</div></div>
                <div className={styles.docMeta}><span>{dateLabel(doc.updated_at)}</span><span>{doc.created_by || "系统"}</span></div>
              </button>)}
            </div> : <div className={styles.empty}><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={hasFilters ? "没有符合条件的文档，试试调整筛选或关键词。" : "还没有文档，从记录第一份工作经验开始。"} />{!hasFilters && <Button type="primary" onClick={() => edit()}>新建文档</Button>}</div>}
          </Spin>}
          {!error && ordered.length > 0 && <footer className={styles.footer}><span>{docs.length >= 500 ? "最多载入 500 篇，请通过搜索缩小范围" : `共 ${ordered.length} 篇文档`}</span><Pagination current={currentPage} total={ordered.length} pageSize={12} showSizeChanger={false} onChange={setPage} size="small" /></footer>}
        </> : <>
          <div className={styles.actionBar}><Button type="text" icon={<ArrowLeftOutlined />} onClick={back} disabled={saving || mutating}>返回文档列表</Button><div className={styles.actions}>
            {view === "edit" ? <><span className={styles.saveState}>{dirty ? "有未保存的修改" : "尚无修改"}</span><Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={save}>{editingId ? "保存修改" : "创建文档"}</Button></> : detail && <><Button icon={<DownloadOutlined />} onClick={download}>导出</Button>{writable && <><Button icon={<PushpinFilled />} loading={mutating} onClick={() => mutate()}>{detail.pinned ? "取消置顶" : "置顶"}</Button><Button icon={<EditOutlined />} onClick={() => edit(detail)} disabled={mutating}>编辑</Button><Popconfirm title="删除这篇文档？" description="删除后无法恢复。" okText="删除" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => mutate(true)}><Button danger icon={<DeleteOutlined />} aria-label="删除文档" disabled={mutating} /></Popconfirm></>}</>}
          </div></div>
          {view === "edit" ? <div className={styles.editor}>
            <Input aria-label="文档标题" placeholder="输入文档标题" maxLength={200} value={draft.title} onChange={(e) => patchDraft({ title: e.target.value })} className={styles.titleInput} disabled={saving} />
            <div className={styles.editorFields}>
              <div className={styles.field}><span>分类</span><Select aria-label="文档分类" showSearch optionFilterProp="label" value={draft.category} onChange={(category) => patchDraft({ category })} disabled={saving} options={Array.from(new Set(["未分类", draft.category, ...categories.map((c) => c.name)])).map((name) => ({ value: name, label: name }))} /></div>
              <div className={`${styles.field} ${styles.tagsField}`}><span>标签</span><Select aria-label="文档标签" mode="tags" maxCount={10} maxTagCount="responsive" placeholder="输入后回车，最多 10 个" value={draft.tags} disabled={saving} onChange={(values) => patchDraft({ tags: Array.from(new Set(values.map((v: string) => v.trim()).filter(Boolean))).slice(0, 10) })} tokenSeparators={[",", "，", ";", "；"]} options={tags.map((t) => ({ value: t.name, label: t.name }))} /></div>
              <div className={styles.field}><span>可见范围</span><VisibilitySelect user={user} value={draft.visibility} disabled={saving} onChange={(visibility) => patchDraft({ visibility })} /></div>
            </div>
            <div className={styles.editorToolbar}><Segmented value={pane} onChange={(v) => setPane(String(v))} options={[{ value: "write", label: "编写" }, { value: "split", label: "对照预览" }, { value: "preview", label: "预览" }]} /><span>Markdown · {draft.content.length} 字符</span></div>
            <div className={`${styles.editorPanes} ${pane === "split" ? styles.split : ""}`}>
              {pane !== "preview" && <Input.TextArea aria-label="文档正文" value={draft.content} disabled={saving} onChange={(e) => patchDraft({ content: e.target.value })} placeholder={"## 记录你的知识\n\n支持标题、列表、表格和代码块。"} autoSize={{ minRows: 22 }} className={styles.textarea} />}
              {pane !== "write" && <div className={styles.preview}><DocMarkdown content={draft.content} /></div>}
            </div>
          </div> : detailLoading ? <div className={styles.empty}><Spin description="正在加载文档"><div style={{ height: 160 }} /></Spin></div> : detailError ? <Alert type="error" title="无法打开文档" description={detailError} action={<Button onClick={() => selectedId && openDoc(selectedId)}>重试</Button>} /> : detail && <article className={styles.article}>
            <div className={styles.articleCategory}><FolderOutlined /> {detail.category}{!!detail.pinned && <Tag icon={<PushpinFilled />}>已置顶</Tag>}</div><h2>{detail.title}</h2>
            <div className={styles.articleMeta}><span>{detail.owner_name || detail.created_by || "系统"}</span><span>更新于 {dateLabel(detail.updated_at)}</span><VisibilityTag value={detail.visibility} /><SourceTag source={detail.source} />{!writable && <Tag>只读</Tag>}</div>
            {!!detail.tags.length && <div className={styles.articleTags}>{detail.tags.map((tag) => <Tag key={tag}>{tag}</Tag>)}</div>}
            <div className={styles.articleContent}><DocMarkdown content={detail.content} /></div>
            <footer className={styles.articleFooter}>创建于 {dateLabel(detail.created_at)} · {detail.content.length} 字符</footer>
          </article>}
        </>}
      </main>
    </div>
  </section>;
}
