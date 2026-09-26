"use client";

import { useMemo, type ReactNode } from "react";

/**
 * skill.yml / workflow YAML 定义的轻量语法高亮（浅色主题配色，无第三方依赖）。
 * 配色与 RunOutput 的 JSON 高亮一致：键蓝 / 字符串绿 / 数字橙 / 布尔橙红 / 注释灰。
 */

const C_KEY = "#0958a8";
const C_STR = "#2b7d2b";
const C_NUM = "#b3540e";
const C_BOOL = "#c6410c";
const C_PUNCT = "#8c8c8c";
const C_COMMENT = "#999999";

/** 行内值部分：字符串 / 数字 / 布尔 / 尾注释 */
function highlightValue(s: string, base = 0): ReactNode[] {
  const nodes: ReactNode[] = [];
  const RE = /("[^"\n]*"|'[^'\n]*')|(#.*$)|\b(true|false|null|yes|no)\b|(-?\d+(?:\.\d+)?)/g;
  let last = 0;
  let i = base;
  let m: RegExpExecArray | null;
  RE.lastIndex = 0;
  while ((m = RE.exec(s)) !== null) {
    if (m.index > last) nodes.push(s.slice(last, m.index));
    if (m[1] !== undefined) nodes.push(<span key={i++} style={{ color: C_STR }}>{m[1]}</span>);
    else if (m[2] !== undefined) nodes.push(<span key={i++} style={{ color: C_COMMENT, fontStyle: "italic" }}>{m[2]}</span>);
    else if (m[3] !== undefined) nodes.push(<span key={i++} style={{ color: C_BOOL }}>{m[3]}</span>);
    else nodes.push(<span key={i++} style={{ color: C_NUM }}>{m[4]}</span>);
    last = RE.lastIndex;
  }
  if (last < s.length) nodes.push(s.slice(last));
  return nodes;
}

/** 单行高亮：注释行 / 「key: value」（含 "- key: value" 列表项）/ 纯值行 */
function highlightLine(line: string, seq: number): ReactNode {
  if (/^\s*#/.test(line)) {
    return <span style={{ color: C_COMMENT, fontStyle: "italic" }}>{line || "\u00a0"}</span>;
  }
  const m = /^(\s*(?:-\s+)?)([A-Za-z_][\w.\-/ ]*?)(:)(\s+|$)/.exec(line);
  if (m) {
    const rest = line.slice(m[0].length);
    return (
      <>
        {m[1] ? <span style={{ color: C_PUNCT }}>{m[1]}</span> : null}
        <span style={{ color: C_KEY, fontWeight: 500 }}>{m[2]}</span>
        <span style={{ color: C_PUNCT }}>{m[3]}</span>
        {m[4] ? <span>{m[4]}</span> : null}
        {rest ? highlightValue(rest, seq * 16) : null}
      </>
    );
  }
  return <>{highlightValue(line, seq * 16)}</>;
}

export default function YamlBlock({
  source,
  maxHeight = 300,
}: {
  source: string;
  maxHeight?: number;
}) {
  const lines = useMemo(() => source.split("\n"), [source]);
  return (
    <pre
      style={{
        margin: 0,
        padding: 12,
        background: "#fafafa",
        borderRadius: 8,
        fontSize: 12,
        lineHeight: 1.65,
        maxHeight,
        overflowY: "auto",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
      }}
    >
      {lines.map((l, i) => (
        <div key={i}>{l.trim() ? highlightLine(l, i) : "\u00a0"}</div>
      ))}
    </pre>
  );
}
