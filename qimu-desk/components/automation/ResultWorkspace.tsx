"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Button, Empty, Spin, Typography } from "antd";
import { ArrowLeftOutlined, FileTextOutlined } from "@ant-design/icons";
import RunOutput from "@/components/skills/RunOutput";
import styles from "./ResultWorkspace.module.css";

export type ResultEntry = { id: string; title: string; detail?: string; status?: ReactNode; disabled?: boolean };

export default function ResultWorkspace({ title, subtitle, status, navigationTitle, entries, activeId, onSelect, onBack, toolbar, outputTitle, output, notice, loading, emptyText, details }: {
  title: string; subtitle: string; status?: ReactNode; navigationTitle: string;
  entries: ResultEntry[]; activeId?: string; onSelect: (id: string) => void; onBack: () => void;
  toolbar?: ReactNode; outputTitle: string; output: string; notice?: ReactNode;
  loading?: boolean; emptyText: string; details?: ReactNode;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  return <section className={styles.workspace} aria-label="执行结果阅读区">
    <header className={styles.header}>
      <Button icon={<ArrowLeftOutlined />} onClick={onBack}>返回参数</Button>
      <div className={styles.title}><span>{subtitle}</span><h1 ref={heading} tabIndex={-1}>{title}</h1></div>
      <div className={styles.status}>{status}</div>
    </header>
    <div className={styles.layout}>
      <aside className={styles.sidebar} aria-label={navigationTitle}>
        <div className={styles.sidebarHeading}><h2>{navigationTitle}</h2><span>{entries.length}</span></div>
        {toolbar && <div className={styles.toolbar}>{toolbar}</div>}
        <nav className={styles.navigation} aria-label={navigationTitle}>
          {entries.map((entry, index) => <button type="button" key={entry.id} disabled={entry.disabled} aria-current={entry.id === activeId ? "true" : undefined} onClick={() => onSelect(entry.id)}>
            <span className={styles.index}>{String(index + 1).padStart(2, "0")}</span>
            <span className={styles.entry}><strong>{entry.title}</strong>{entry.detail && <small>{entry.detail}</small>}{entry.status && <span>{entry.status}</span>}</span>
          </button>)}
          {!entries.length && <p className={styles.hint}>{loading ? "执行记录将在完成后显示" : "还没有执行记录"}</p>}
        </nav>
      </aside>
      <article className={styles.document} aria-label="当前结果">
        <div className={styles.documentHeading}><div><span className={styles.eyebrow}><FileTextOutlined /> 运行输出</span><h2>{outputTitle}</h2></div>
          {output.trim() && <Typography.Text copyable={{ text: output }}>复制结果</Typography.Text>}
        </div>
        <div className={styles.body}>
          {notice && <div className={styles.notice}>{notice}</div>}
          {loading && <div className={styles.progress} role="status"><Spin size="small" /><span>正在执行，结果会自动更新</span></div>}
          {output.trim() ? <RunOutput output={output} expanded /> : !loading && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} />}
          {details && <details className={styles.details}><summary>查看执行详情</summary>{details}</details>}
        </div>
      </article>
    </div>
  </section>;
}
