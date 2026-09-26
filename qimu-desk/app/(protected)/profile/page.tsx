import { currentUser } from "@/core/auth";
import ProfileView from "@/components/profile/ProfileView";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const user = await currentUser();
  if (!user) {
    return <div>请先登录</div>;
  }

  return <ProfileView user={user} />;
}
