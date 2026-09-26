import { currentUser } from "@/core/auth";
import { listProjects } from "@/core/projects";
import { redirect } from "next/navigation";
import ProjectManager from "@/components/tasks/ProjectManager";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  const projects = await listProjects(user, true);
  return <ProjectManager projects={projects} user={{ id: user.id, role: user.role }} />;
}
