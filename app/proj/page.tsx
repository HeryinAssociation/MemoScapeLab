import { AdminShell } from "../admin-shell";
import { ProjectsApp } from "./projects-app";

export default function ProjectsPage() {
  return (
    <AdminShell active="projects">
      <ProjectsApp />
    </AdminShell>
  );
}
