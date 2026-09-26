import { redirect } from "next/navigation";
import { currentUser } from "@/core/auth";
import ChatWorkspace from "@/components/chat/ChatWorkspace";

export const dynamic = "force-dynamic";

/** 聊天页（chat-module）：Server Component 校验登录后渲染客户端三栏 IM 主体 */
export default async function ChatPage() {
  const user = await currentUser();
  if (!user) redirect("/login");

  return (
    <ChatWorkspace
      meId={user.id}
      meName={user.displayName || user.username}
    />
  );
}
