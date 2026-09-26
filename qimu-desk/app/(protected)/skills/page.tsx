import { listSkills, listRuns } from "@/core/skills";
import { currentUser } from "@/core/auth";
import SkillsView from "@/components/skills/SkillsView";

export const dynamic = "force-dynamic";

export default async function SkillsPage() {
  // listSkills 内部会先播种 skills/ 目录，页面永远展示最新注册结果
  const user = await currentUser();
  const [skills, recentRuns] = await Promise.all([
    listSkills(user),
    listRuns(undefined, 10),
  ]);
  return <SkillsView initialSkills={skills} initialRuns={recentRuns} />;
}
