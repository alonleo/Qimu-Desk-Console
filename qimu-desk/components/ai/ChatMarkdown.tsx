"use client";

import dynamic from "next/dynamic";

/**
 * AI 消息气泡内的 Markdown 渲染（懒加载包装器）。
 *
 * 对外接口与旧实现完全一致（{ content: string }），但真实渲染体 ChatMarkdownBody
 * 通过 next/dynamic(ssr:false) 按需加载——react-markdown + remark 系列依赖只会
 * 在「确实渲染 markdown」时进入客户端 chunk，而不是打进 AI 页首屏主包。
 */
const ChatMarkdownBody = dynamic(() => import("@/components/ai/ChatMarkdownBody"), {
  ssr: false,
  loading: () => (
    <div style={{ color: "rgba(0,0,0,0.45)", fontSize: 13, padding: "2px 0" }}>加载渲染器…</div>
  ),
});

export default function ChatMarkdown({ content, size }: { content: string; size?: number }) {
  return <ChatMarkdownBody content={content} size={size} />;
}
