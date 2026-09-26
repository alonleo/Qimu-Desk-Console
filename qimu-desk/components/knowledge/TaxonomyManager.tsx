"use client";

import { useEffect, useRef, useState } from "react";
import { Alert, App, Button, Drawer, Empty, Input, Popconfirm, Segmented, Spin } from "antd";
import { DeleteOutlined, PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import styles from "./knowledge.module.css";

type Kind = "categories" | "tags";
type Item = { name: string; count: number };
export default function TaxonomyManager({ open, onClose, onChanged }: {
  open: boolean; onClose: () => void;
  onChanged: (kind: Kind, removed: string | null) => void;
}) {
  const { message } = App.useApp();
  const [kind, setKind] = useState<Kind>("categories");
  const [items, setItems] = useState<Record<Kind, Item[]>>({ categories: [], tags: [] });
  const [names, setNames] = useState<Record<Kind, string>>({ categories: "", tags: "" });
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const seq = useRef(0);
  const busyRef = useRef(false);
  const label = kind === "categories" ? "分类" : "标签";

  async function reload() {
    const id = ++seq.current;
    setLoading(true); setError("");
    try {
      const data = await Promise.all((["categories", "tags"] as const).map(async (key) => {
        const response = await fetch(`/api/knowledge/${key}`, { cache: "no-store" });
        const data = await response.json();
        if (!response.ok || data.error) throw new Error(data.error || "加载失败，请重试");
        return data[key] as Item[];
      }));
      if (id === seq.current) setItems({ categories: data[0], tags: data[1] });
    } catch (e) { if (id === seq.current) setError((e as Error).message); }
    finally { if (id === seq.current) setLoading(false); }
  }
  useEffect(() => {
    if (open) { setNames({ categories: "", tags: "" }); void reload(); }
    return () => { seq.current++; };
  }, [open]);

  async function change(removed?: string) {
    if (busyRef.current) return;
    const name = (removed ?? names[kind]).trim();
    if (!name) { message.warning(`请输入${label}名称`); return; }
    if (removed === undefined && items[kind].some((item) => item.name === name)) { message.warning(`${label}已存在`); return; }
    busyRef.current = true; setBusy(true); setError("");
    try {
      const query = removed === undefined ? "" : `?${new URLSearchParams({ name })}`;
      const response = await fetch(`/api/knowledge/${kind}${query}`, {
        method: removed === undefined ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        ...(removed === undefined ? { body: JSON.stringify({ name }) } : {}),
      });
      const data = await response.json();
      if (!response.ok || data.error || data.ok === false) throw new Error(data.error || "操作失败，请重试");
      if (removed === undefined) setNames((old) => ({ ...old, [kind]: "" }));
      message.success(removed === undefined ? `${label}已新增` : kind === "categories" ? `分类已删除，${data.moved ?? 0} 篇文档移至未分类` : `标签已删除，已从 ${data.updated ?? 0} 篇文档中移除`);
      onChanged(kind, removed ?? null);
      await reload();
    } catch (e) { setError((e as Error).message); }
    finally { busyRef.current = false; setBusy(false); }
  }

  return <Drawer title="管理分类和标签" open={open} onClose={() => { if (!busy) onClose(); }} closable={!busy} maskClosable={!busy} keyboard={!busy} size={440}>
    <div className={styles.taxonomy}>
      <Segmented block value={kind} disabled={busy} onChange={(value) => setKind(value as Kind)} options={[{ label: "分类", value: "categories" }, { label: "标签", value: "tags" }]} />
      <p className={styles.taxonomyHint}>{kind === "categories" ? "分类供整个知识库使用。删除后，文档移到“未分类”，正文保留。" : "新增标签可直接用于文档。删除标签会移除所有文档中的同名标签，正文保留。"}</p>
      <form className={styles.taxonomyForm} onSubmit={(event) => { event.preventDefault(); void change(); }}>
        <Input aria-label={`新${label}名称`} placeholder={`输入新${label}名称`} maxLength={30} value={names[kind]} disabled={busy} onChange={(event) => setNames((old) => ({ ...old, [kind]: event.target.value }))} />
        <Button htmlType="submit" type="primary" icon={<PlusOutlined />} loading={busy} disabled={loading}>新增{label}</Button>
      </form>
      {error && <Alert type="error" showIcon title={error} />}
      <div className={styles.taxonomyHeading}><span>{items[kind].length} 个{label}</span><Button size="small" type="text" icon={<ReloadOutlined />} onClick={() => reload()} loading={loading} disabled={busy} aria-label="刷新分类和标签" /></div>
      <Spin spinning={loading}>
        {items[kind].length ? <ul className={styles.taxonomyList}>{items[kind].map((item) => <li key={item.name}>
          <div><strong>{item.name}</strong><span>{item.count} 篇文档{kind === "categories" && item.name === "未分类" ? " · 默认分类" : ""}</span></div>
          {kind === "categories" && item.name === "未分类" ? <span className={styles.taxonomyHint}>保留</span> : <Popconfirm title={`删除${label}“${item.name}”？`} description={kind === "categories" ? "相关文档将移到“未分类”，文档不会被删除。" : "所有文档中的同名标签将被移除，文档不会被删除。"} okText="删除" cancelText="取消" okButtonProps={{ danger: true }} disabled={busy} onConfirm={() => change(item.name)}>
            <Button type="text" danger icon={<DeleteOutlined />} disabled={busy} aria-label={`删除${label} ${item.name}`} />
          </Popconfirm>}
        </li>)}</ul> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={`还没有${label}，可以在上方新增。`} />}
      </Spin>
    </div>
  </Drawer>;
}
