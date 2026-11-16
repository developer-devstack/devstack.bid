/**
 * Re-download a Cursor Origin repo snapshot into R2 (same path as import-cursor).
 */
import type { R2BucketLike } from "@/lib/hosting/serve";
import { fetchOriginTarball } from "@/lib/auth/cursor-origin-client";
import type { D1Like } from "@/lib/chat/store";
import { ServiceError } from "@/lib/connections/github-service";
import type { ProjectRow } from "@/lib/connections/projects";
import { putProjectSource } from "@/lib/hosting/sources";
import { readTar, type TarFile } from "@/lib/build/tar";
import { CURSOR_SOURCE } from "./import-cursor";

function stripArchivePrefix(files: TarFile[]): TarFile[] {
  if (!files.length) return files;
  const top = files[0].path.split("/")[0];
  if (!top || !files.every((f) => f.path === top || f.path.startsWith(`${top}/`))) return files;
  return files
    .map((f) => ({ path: f.path === top ? "" : f.path.slice(top.length + 1), bytes: f.bytes }))
    .filter((f) => f.path && !f.path.startsWith("/") && !f.path.split("/").includes(".."));
}

export async function syncCursorProject(
  db: D1Like,
  project: ProjectRow,
  installToken: string,
  sites: R2BucketLike | null,
  branch?: string,
): Promise<{ branch: string; fileCount: number }> {
  if (project.source !== CURSOR_SOURCE) throw new ServiceError("invalid", "Only Cursor-imported projects can sync from Origin.", 400);
  const conn = await db
    .prepare("SELECT repo_full_name FROM project_connections WHERE project_id = ?1 AND provider = 'cursor' LIMIT 1")
    .bind(project.id)
    .first<{ repo_full_name: string | null }>();
  const fullName = conn?.repo_full_name ?? project.repo_full_name;
  if (!fullName?.includes("/")) throw new ServiceError("invalid", "Project has no linked Cursor repository.", 422);
  const ref = branch?.trim() || project.default_branch || project.production_branch || "main";
  let tar: Uint8Array;
  try {
    tar = await fetchOriginTarball(installToken, fullName, ref);
  } catch (err) {
    throw new ServiceError("forbidden", err instanceof Error ? err.message : "Could not download repository snapshot.", 403);
  }
  let files: TarFile[];
  try {
    files = stripArchivePrefix(readTar(tar));
  } catch {
    throw new ServiceError("invalid", "Repository archive is empty or too large.", 422);
  }
  if (project.root_directory && !files.some((f) => f.path === project.root_directory || f.path.startsWith(`${project.root_directory}/`))) {
    throw new ServiceError("invalid", `Root directory "${project.root_directory}" not found.`, 422);
  }
  if (!sites) throw new ServiceError("blocked", "Hosting storage is not configured.", 503);
  await putProjectSource(sites, project.id, files);
  const now = Date.now();
  await db
    .prepare("UPDATE projects SET default_branch = ?2, production_branch = ?2, updated_at = ?3 WHERE id = ?1")
    .bind(project.id, ref, now)
    .run();
  return { branch: ref, fileCount: files.length };
}