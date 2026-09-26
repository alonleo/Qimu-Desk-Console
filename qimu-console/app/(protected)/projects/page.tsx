import { serverApi } from "@/utils/serverApi";
import ProjectsManager, { type ProjectRow } from "@/components/tasks/ProjectsManager";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const projects = await serverApi<ProjectRow[]>("/projects?all=1");
  return <ProjectsManager projects={projects} />;
}
