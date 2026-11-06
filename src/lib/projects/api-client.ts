/** Shared browser fetch for GET /api/projects (same shape as `projectView`). */

export type ProjectListItem = {
  id: string;
  name: string;
  repo: string | null;
  repoUrl: string | null;
  templateId: string | null;
  createdAt: number;
};

export async function fetchProjectList(): Promise<{ unauthorized: boolean; projects: ProjectListItem[] }> {
  const r = await fetch("/api/projects", { cache: "no-store" });
  const b = (await r.json().catch(() => ({}))) as { projects?: ProjectListItem[]; error?: string };
  if (r.status === 401) return { unauthorized: true, projects: [] };
  if (!r.ok) throw new Error(b.error ?? "Could not load projects");
  return { unauthorized: false, projects: b.projects ?? [] };
}
