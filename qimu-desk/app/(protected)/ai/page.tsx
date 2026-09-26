/**
 * AI 助手视图由 AppShell 常驻挂载（首次进入 /ai 后跨模块切换不卸载，
 * 保证流式回复与会话状态不中断），本页面仅承载路由，不再渲染 AIView。
 */
export default function AIPage() {
  return null;
}
