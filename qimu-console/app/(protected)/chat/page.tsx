import ChatAdminManager from "@/components/ChatAdminManager";

export const dynamic = "force-dynamic";

/** 消息会话管理页（chat-admin-module）：管理员查看/管理系统内全部用户之间的会话与消息 */
export default function ChatPage() {
  return <ChatAdminManager />;
}
