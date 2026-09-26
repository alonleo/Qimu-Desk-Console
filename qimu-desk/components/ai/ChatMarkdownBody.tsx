"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";

/**
 * AI 消息气泡内的 Markdown 渲染（实际渲染体，经 ChatMarkdown 懒加载引用，
 * 让 react-markdown / remark 只在使用时进入客户端 chunk）。
 * - remark-gfm：表格 / 删除线 / 任务列表
 * - remark-breaks：单个换行渲染为 <br>（聊天场景惯例，避免 AI 输出被合并成一行）
 * - 容器 white-space 为 normal（不要 pre-wrap，否则 JSX 节点间的换行会导致间距翻倍）
 * - 排版与气泡字号一致（14px / 1.7），配色与 AI 助手紫色主题呼应
 */
export default function ChatMarkdownBody({ content, size = 14 }: { content: string; size?: number }) {
  return (
    <div className="chat-markdown" style={{ fontSize: size, lineHeight: 1.7 }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={{
          h1: ({ children }) => (
            <h1 style={{ fontSize: 18, fontWeight: 600, margin: "14px 0 8px", lineHeight: 1.4 }}>{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 style={{ fontSize: 16.5, fontWeight: 600, margin: "14px 0 8px", lineHeight: 1.4 }}>{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 style={{ fontSize: 15, fontWeight: 600, margin: "12px 0 6px", lineHeight: 1.4 }}>{children}</h3>
          ),
          h4: ({ children }) => (
            <h4 style={{ fontSize: 14, fontWeight: 600, margin: "12px 0 6px", lineHeight: 1.4 }}>{children}</h4>
          ),
          h5: ({ children }) => (
            <h5 style={{ fontSize: 14, fontWeight: 600, margin: "10px 0 6px" }}>{children}</h5>
          ),
          h6: ({ children }) => (
            <h6 style={{ fontSize: 14, fontWeight: 600, margin: "10px 0 6px" }}>{children}</h6>
          ),
          p: ({ children }) => <p style={{ margin: "6px 0", wordBreak: "break-word" }}>{children}</p>,
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "#00c896", wordBreak: "break-all" }}
            >
              {children}
            </a>
          ),
          ul: ({ children }) => <ul style={{ paddingLeft: 20, margin: "6px 0" }}>{children}</ul>,
          ol: ({ children }) => <ol style={{ paddingLeft: 20, margin: "6px 0" }}>{children}</ol>,
          li: ({ children }) => <li style={{ marginBottom: 4 }}>{children}</li>,
          blockquote: ({ children }) => (
            <blockquote
              style={{
                borderLeft: "3px solid #0ea5e9",
                background: "#faf5ff",
                padding: "6px 12px",
                borderRadius: "0 6px 6px 0",
                margin: "8px 0",
                color: "#595959",
              }}
            >
              {children}
            </blockquote>
          ),
          hr: () => <hr style={{ border: "none", borderTop: "1px solid #f0f0f0", margin: "12px 0" }} />,
          code: ({ className, children }) => {
            const isBlock = /language-/.test(className || "");
            if (isBlock) {
              return (
                <code style={{ display: "block", padding: 0, background: "transparent", fontSize: 12.5 }}>
                  {children}
                </code>
              );
            }
            return (
              <code
                style={{
                  background: "rgba(0, 200, 150, 0.08)",
                  color: "#8738c2",
                  padding: "1px 6px",
                  borderRadius: 4,
                  fontSize: 13,
                  fontFamily:
                    "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace",
                  wordBreak: "break-word",
                }}
              >
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre
              style={{
                background: "#282c34",
                color: "#abb2bf",
                borderRadius: 8,
                padding: "10px 14px",
                fontSize: 12.5,
                lineHeight: 1.6,
                overflowX: "auto",
                margin: "8px 0",
                fontFamily:
                  "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace",
              }}
            >
              {children}
            </pre>
          ),
          table: ({ children }) => (
            <div style={{ overflowX: "auto", margin: "8px 0" }}>
              <table
                style={{
                  borderCollapse: "collapse",
                  fontSize: 13,
                  minWidth: "60%",
                  margin: "0 auto",
                }}
              >
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => <thead style={{ background: "#fafafa" }}>{children}</thead>,
          th: ({ children }) => (
            <th
              style={{
                border: "1px solid #f0f0f0",
                padding: "6px 12px",
                textAlign: "left",
                fontWeight: 600,
                whiteSpace: "nowrap",
              }}
            >
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td style={{ border: "1px solid #f0f0f0", padding: "6px 12px", wordBreak: "break-word" }}>
              {children}
            </td>
          ),
          img: ({ src, alt }) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={typeof src === "string" ? src : undefined}
              alt={alt || ""}
              style={{ maxWidth: "100%", borderRadius: 8, margin: "4px 0" }}
            />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
