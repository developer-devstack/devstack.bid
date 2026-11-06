import type { Metadata } from "next";
import { ProjectsCreate } from "@/components/projects/projects-create";
import { SettingsNav } from "@/components/settings-nav";

export const metadata: Metadata = { title: "Projects", description: "Create DevStack projects, upload zips, and open your sites.", robots: { index: false } };

export default function ProjectsPage() {
  return (
    <>
      <SettingsNav />
      <ProjectsCreate />
    </>
  );
}
