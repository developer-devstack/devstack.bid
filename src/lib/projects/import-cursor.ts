/**
 * Import a Cursor Origin repository into DevStack hosting (R2 tar archive + D1).
 * No GitHub clone; builds use the archive path in the build executor.
 */
import type { R2BucketLike } from "@/lib/hosting/serve";
import { fetchOriginTarball, type OriginRepo } from "@/lib/auth/cursor-origin-client";
import type { D1Like } from "@/lib/chat/store";
import { audit } from "@/lib/connections/audit";
import { ServiceError } from "@/lib/connections/github-service";
import type { ProjectRow } from "@/lib/connections/projects";
import { putProjectSource } from "@/lib/hosting/sources";
import { readTar, type TarFile } from "@/lib/build/tar";
import { assertSlugUsable } from "./slug-gate";
import { detectFramework, underRoot, validateBuildConfig, validateRootDirectory, validateSlug, type FrameworkPreset } from "./config";

export const CURSOR_SOURCE = "cursor_import";

function stripArchivePrefix(files: TarFile[]): TarFile[] {
  if (!files.length) return files;
  const top = files[0].path.split("/")[0];
  if (!top || !files.every((f) => f.path === top || f.path.startsWith(`${top}/`))) return files;
  return files
    .map((f) => ({ path: f.path === top ? "" : f.path.slice(top.length + 1), bytes: f.bytes }))
    .filter((f) => f.path && !f.path.startsWith("/") && !f.path.split("/").includes(".."));
}

function readPkg(files: TarFile[], root: string): Parameters<typeof detectFramework>[1] {
  const p = root ? `${root}/package.json` : "package.json";
  const f = files.find((x) => x.path === p);
  if (!f) return null;
  try {
    return JSON.parse(new TextDecoder().decode(f.bytes));
  } catch {
    return null;
  }
}

export async function importCursorRepo(
  db: D1Like,
  uid: string,
  installToken: string,
  body: { repo?: unknown; repoId?: unknown; branch?: unknown; rootDirectory?: unknown; name?: unknown; build?: unknown },
  sites: R2BucketLike | null,
  repoMeta?: Pick<OriginRepo, "fullName" | "defaultBranch">,
): Promise<ProjectRow> {
  const fullName = typeof body.repo === "string" ? body.repo.trim() : repoMeta?.fullName ?? "";
  if (!fullName.includes("/")) throw new ServiceError("invalid", "Repository must look like owner/name.", 400);
  const slugV = validateSlug(body.name ?? fullName.split("/")[1]);
  if (!slugV.ok) throw new ServiceError("invalid", slugV.error, 400);
  const root = validateRootDirectory(body.rootDirectory);
  if (root === null) throw new ServiceError("invalid", "Invalid root directory.", 400);
  const cfgV = validateBuildConfig(body.build);
  if (!cfgV.ok) throw new ServiceError("invalid", cfgV.error, 400);

  const branch = typeof body.branch === "string" && body.branch.trim() ? body.branch.trim() : repoMeta?.defaultBranch ?? "main";
  let tar: Uint8Array;
  try {
    tar = await fetchOriginTarball(installToken, fullName, branch);
  } catch (err) {
    throw new ServiceError("forbidden", err instanceof Error ? err.message : "Could not download repository snapshot.", 403);
  }
  let files: TarFile[];
  try {
    files = stripArchivePrefix(readTar(tar));
  } catch {
    throw new ServiceError("invalid", "Repository archive is empty or too large.", 422);
  }
  if (root && !files.some((f) => f.path === root || f.path.startsWith(`${root}/`))) {
    throw new ServiceError("invalid", `Root directory "${root}" not found.`, 422);
  }

  const paths = files.map((f) => f.path);
  const framework: FrameworkPreset = detectFramework(underRoot(paths, root), readPkg(files, root));
  const count = await db.prepare("SELECT COUNT(*) AS n FROM projects WHERE user_id = ?1").bind(uid).first<{ n: number }>();
  if (Number(count?.n ?? 0) >= 100) throw new ServiceError("limit", "Project limit reached (100).", 409);
  const dupe = await db.prepare("SELECT id FROM projects WHERE user_id = ?1 AND source = ?2 AND name = ?3 AND root_directory = ?4")
    .bind(uid, CURSOR_SOURCE, slugV.slug, root).first<{ id: string }>();
  if (dupe) throw new ServiceError("conflict", "This Cursor repository is already imported.", 409);
  await assertSlugUsable(db, slugV.slug, null, sites);

  const c = cfgV.config.framework === "unknown" && framework.id !== "unknown"
    ? { ...cfgV.config, framework: framework.id, installCommand: cfgV.config.installCommand || framework.install, buildCommand: cfgV.config.buildCommand || framework.build, outputDirectory: cfgV.config.outputDirectory || framework.output || "dist" }
    : cfgV.config;

  const id = crypto.randomUUID();
  const now = Date.now();
  if (sites) await putProjectSource(sites, id, files);

  await db.batch([
    db.prepare(
      "INSERT INTO projects (id, user_id, name, template_id, repo_full_name, default_branch, slug, source, root_directory, framework, install_command, build_command, output_directory, node_version, production_branch, provider, updated_at) VALUES (?1, ?2, ?3, NULL, NULL, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, '22', ?4, 'devstack-sites', ?12)",
    ).bind(id, uid, slugV.slug, branch, slugV.slug, CURSOR_SOURCE, root, c.framework, c.installCommand, c.buildCommand, c.outputDirectory, now),
    db.prepare(
      "INSERT INTO project_connections (id, project_id, user_id, provider, installation_id, repo_id, repo_full_name, private, can_push) VALUES (?1, ?2, ?3, 'cursor', NULL, ?4, ?5, ?6, 0)",
    ).bind(crypto.randomUUID(), id, uid, null, fullName, 0),
  ]).catch((e: unknown) => {
    if (/UNIQUE/i.test(String((e as Error)?.message)) && /slug/i.test(String((e as Error)?.message))) {
      throw new ServiceError("conflict", `Project name "${slugV.slug}" is already used.`, 409);
    }
    throw e;
  });

  await audit(db, uid, "project.imported", `cursor:${fullName}${root ? `/${root}` : ""}@${branch}`);
  return {
    id, user_id: uid, name: slugV.slug, template_id: null, repo_full_name: null, default_branch: branch, created_at: now,
    slug: slugV.slug, source: CURSOR_SOURCE, root_directory: root, framework: c.framework, install_command: c.installCommand,
    build_command: c.buildCommand, output_directory: c.outputDirectory, node_version: "22", production_branch: branch, provider: "devstack-sites",
  };
}
