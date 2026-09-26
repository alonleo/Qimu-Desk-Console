import type { Metadata } from "next";
import "./globals.css";
import { AntdRegistry } from "@ant-design/nextjs-registry";
import Providers from "@/components/Providers";

export const metadata: Metadata = {
  title: "Qimu Desk · 栖木工作台",
  description: "个人工作台：技能、工作流、知识库与任务项目",
  // 品牌 Logo：浏览器标签与桌面快捷方式。
  icons: {
    icon: [
      { url: "/logo-brand.png", type: "image/png", sizes: "any" },
    ],
    shortcut: [{ url: "/logo-brand.png", type: "image/png", sizes: "any" }],
    // 移动端添加到主屏。
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
