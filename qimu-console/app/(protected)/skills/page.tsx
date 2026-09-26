import { serverApi } from "@/utils/serverApi";
import SkillsManager, { type SkillItem, type SkillRunRow } from "@/components/skills/SkillsManager";

export const dynamic = "force-dynamic";

export default async function SkillsPage() {
  const { skills } = await serverApi<{ skills: SkillItem[] }>("/skills");
  const { runs } = await serverApi<{ runs: SkillRunRow[] }>("/skill-runs?limit=20");
  return <SkillsManager skills={skills} runs={runs} />;
}
