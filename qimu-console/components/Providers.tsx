"use client";
import { App, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: "#345d88",
          colorLink: "#345d88",
          colorInfo: "#345d88",
          colorSuccess: "#40846b",
          colorWarning: "#b48032",
          colorError: "#c04d4d",
          colorText: "#263445",
          colorTextSecondary: "#687787",
          colorBorder: "#dce2e8",
          colorBgLayout: "#f4f6f8",
          borderRadius: 6,
          fontSize: 13,
          controlHeight: 34,
          fontFamily:
            '"Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
        },
        components: {
          Menu: {
            itemMarginInline: 10,
            itemBorderRadius: 5,
            iconSize: 16,
            itemSelectedBg: "#e7edf4",
            itemSelectedColor: "#284d75",
            itemHeight: 40,
          },
          Card: { borderRadiusLG: 8, headerFontSize: 14, headerHeight: 52 },
          Layout: {
            siderBg: "#f8fafb",
            headerBg: "#ffffff",
            headerHeight: 60,
            bodyBg: "#f4f6f8",
          },
          Table: {
            headerBg: "#f6f8fa",
            headerColor: "#687787",
            cellPaddingBlock: 13,
          },
          Button: { primaryShadow: "none", defaultShadow: "none" },
          Tabs: { titleFontSize: 13 },
        },
      }}
    >
      <App>{children}</App>
    </ConfigProvider>
  );
}
