import type { Metadata } from "next";
import "./globals.css";
import { AntdRegistry } from "@ant-design/nextjs-registry";
import Providers from "@/components/Providers";

export const metadata: Metadata = {
  title: "Qimu Console · 栖木管理台",
  description: "Qimu Desk 后台管理平台：用户、任务、技能、工作流、知识、聊天、通知与 AI 管理",
  // 管理后台专属 Logo，与工作台保持同系列。
  icons: {
    icon: [
      { url: "/logo-brand.png", type: "image/png", sizes: "any" },
    ],
    shortcut: [{ url: "/logo-brand.png", type: "image/png", sizes: "any" }],
    apple: [{ url: "/logo-brand.png", type: "image/png", sizes: "any" }],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen antialiased">
        <AntdRegistry>
          <Providers>{children}</Providers>
        </AntdRegistry>
      </body>
    </html>
  );
}
