/**
 * First-party DevStack hosting entrypoint.
 * Default Deploy / Retry deploy lands here (target=devstack → *.devstack.bid).
 * User Cloudflare remains an explicit optional target.
 *
 * Paths:
 *   - GitHub repo  → container build (user OAuth clone) → R2 sites / server Worker
 *   - Zip upload   → static publish to R2 (no build; needs_build rejected)
 *   - cloudflare   → existing startDeploy (customer account)
 */
import "server-only";
import type { D1Like } from "@/lib/chat/store";
import { audit } from "@/lib/connections/audit";
import type { CredentialMeta, SealKeys } from "@/lib/connections/credentials";
import { ServiceError, takeQuota } from "@/lib/connections/github-service";
import type { ProjectRow } from "@/lib/connections/projects";
import { startContainerBuild, type BuildBindings } from "@/lib/build/executor";
import { appendEvent, createBuildJob, transitionJob, type BuildJobRow, type Environment } from "@/lib/build/jobs";
import { startDeploy, getDeployment, type DeploymentRow } from "@/lib/deploy/service";
import { loadProjectFiles, uploadProfile } from "@/lib/deploy/upload";
import { HostTakenError, promoteProduction, publishPreview, writeSite } from "./publish";
import { previewHost, siteSlug } from "./hostnames";
import type { R2BucketLike } from "./serve";

export type HostingTarget = "devstack" | "cloudflare";

export interface HostingDeployOpts {
  ref?: string | null;
  environment?: Environment;
  trigger?: "manual" | "redeploy" | "retry";
  /** Explicit target. Default: devstack. Providing a one-shot CF token forces cloudflare. */
  target?: HostingTarget | null;
  once?: { secret: string; meta: CredentialMeta } | null;
  waitUntil?: (p: Promise<unknown>) => void;
  fetch?: typeof fetch;
}

export type HostingDeployResult =
  | { kind: "devstack-build"; deploymentId: string; jobId: string; previewUrl: string; productionUrl: string | null; deployment: DeploymentRow }
  | { kind: "devstack-static"; deployment: DeploymentRow; previewUrl: string; dnsReady: boolean }
  | { kind: "cloudflare"; deployment: DeploymentRow };

function resolveTarget(opts: HostingDeployOpts): HostingTarget {
  if (opts.once?.secret) return "cloudflare";
  if (opts.target === "cloudflare") return "cloudflare";
  return "devstack";
}

/** Unified Deploy / Retry entry. Defaults to DevStack hosting — no user Cloudflare required. */
export async function startHostingDeploy(
  db: D1Like,
  keys: SealKeys,
  builds: BuildBindings,
  uid: string,
  project: ProjectRow,
  opts: HostingDeployOpts = {},
): Promise<HostingDeployResult> {
  const target = resolveTarget(opts);
  if (target === "cloudflare") {
    if (!opts.waitUntil) throw new ServiceError("invalid", "Cloudflare deploy requires a waitUntil handle.", 500);
    const deployment = await startDeploy(db, keys, uid, project, opts.ref ?? null, opts.waitUntil, opts.fetch ?? fetch, opts.once ?? null);
    return { kind: "cloudflare", deployment };
  }

  if (project.repo_full_name) {
    const r = await startContainerBuild(db, keys, builds, uid, project, {
      ref: opts.ref ?? null,
      environment: opts.environment ?? "preview",
      trigger: opts.trigger === "retry" ? "redeploy" : (opts.trigger ?? "manual"),
    });
    const deployment: DeploymentRow = {
      id: r.deploymentId,
      project_id: project.id,
      user_id: uid,
      commit_sha: r.job.commit_sha,
      ref: r.job.ref,
      target: "devstack-sites",
      status: "queued",
      url: null,
      cf_version_id: null,
      error_code: null,
      error_log: null,
      fix_attempts: 0,
      build_job_id: r.job.id,
      trigger: r.job.trigger,
      environment: r.job.environment,
      created_at: r.job.created_at,
      finished_at: null,
    };
    return { kind: "devstack-build", deploymentId: r.deploymentId, jobId: r.job.id, previewUrl: r.previewUrl, productionUrl: r.productionUrl, deployment };
  }

  return publishUploadedSite(db, builds.sites, builds.dnsReady, uid, project, opts.environment ?? "preview");
}

/**
 * Zip / uploaded static files → R2 sites/<id> + preview hostname.
 * Framework zips that still need `npm run build` are rejected (use GitHub + container).
 */
export async function publishUploadedSite(
  db: D1Like,
  sites: R2BucketLike | null,
  dnsReady: boolean,
  uid: string,
  project: ProjectRow,
  environment: Environment = "preview",
  now: () => number = Date.now,
): Promise<Extract<HostingDeployResult, { kind: "devstack-static" }>> {
  if (!sites) throw new ServiceError("blocked", "R2 SITES binding is not provisioned. / ยังไม่ได้เปิดที่เก็บเว็บ (R2 SITES)", 503);
  const slug = siteSlug(project.slug || project.name);
  if (!slug) throw new ServiceError("invalid", "Project name cannot be used as a site hostname.", 422);

  const files = await loadProjectFiles(db, project.id);
  if (!files.length) throw new ServiceError("invalid", "Upload a deploy zip first. / อัปโหลด zip ก่อน", 422);
  const profile = uploadProfile(files);
  if (profile.path === "none") throw new ServiceError("invalid", "This project is not deployable as a website.", 422);
  if (profile.path !== "direct") {
    throw new ServiceError(
      "invalid",
      "This upload needs a build step. Connect the GitHub repo and Deploy (DevStack will build it), or zip the built output (index.html ready). / ไฟล์นี้ต้อง build ก่อน หรือเชื่อม GitHub แล้วกด Deploy",
      422,
    );
  }

  await takeQuota(db, uid, "deploy");
  const { job } = await createBuildJob(db, {
    projectId: project.id, userId: uid, executor: "direct", environment, trigger: "manual", maxAttempts: 1,
    config: { source: "upload", profile: profile.id, target: "devstack-sites" },
  });
  const deploymentId = crypto.randomUUID();
  await db.prepare(
    "INSERT INTO deployments (id, project_id, user_id, ref, target, status, build_job_id, trigger, environment) VALUES (?1, ?2, ?3, ?4, 'devstack-sites', 'uploading', ?5, 'manual', ?6)",
  ).bind(deploymentId, project.id, uid, "upload", job.id, environment).run();
  await audit(db, uid, "deploy.started", `upload:${project.id}@devstack-sites`);

  let state = "queued" as BuildJobRow["status"];
  const step = async (to: BuildJobRow["status"], msg: string) => {
    const r = await transitionJob(db, job.id, state, to, {}, now());
    if (r) state = to;
    await appendEvent(db, job.id, { level: "info", phase: to, message: msg });
  };

  try {
    await step("claimed", `Static publish of uploaded files (profile ${profile.id}, ${files.length} files).`);
    await step("uploading", "Uploading files to DevStack hosting (R2 SITES).");
    // Prefer index.html / assets; skip wrangler scaffolding that is only for customer-CF direct upload.
    const keep = files.filter((f) => !/^(package(-lock)?\.json|wrangler\.(jsonc?|toml)|DEPLOY\.txt|NOTICE|\.assetsignore)$/i.test(f.path));
    const siteFiles = (keep.length ? keep : files).map((f) => ({ path: f.path, bytes: f.bytes }));
    await writeSite(sites, deploymentId, siteFiles);
    const previewUrl = await publishPreview(sites, slug, project.id, deploymentId);
    let alias: string | null = null;
    if (environment === "production") {
      alias = await promoteProduction(sites, slug, project.id, deploymentId);
      await db.prepare("UPDATE deployments SET alias_url = NULL, environment = 'preview' WHERE project_id = ?1 AND user_id = ?3 AND id != ?2 AND alias_url IS NOT NULL")
        .bind(project.id, deploymentId, uid).run();
    }
    await step("succeeded", `Preview ${previewHost(slug, deploymentId)} → deployment ${deploymentId}`);
    await db.prepare("UPDATE deployments SET status = 'live', url = ?2, alias_url = ?3, finished_at = ?4 WHERE id = ?1")
      .bind(deploymentId, previewUrl, alias, now()).run();
    if (!dnsReady) {
      await appendEvent(db, job.id, { level: "warn", phase: "succeeded", message: "Files published; *.devstack.bid route may not resolve yet (SITES_DNS_READY != 1)." });
    }
    const deployment: DeploymentRow = {
      id: deploymentId, project_id: project.id, user_id: uid, commit_sha: null, ref: "upload", target: "devstack-sites",
      status: "live", url: previewUrl, cf_version_id: null, error_code: null, error_log: null, fix_attempts: 0,
      build_job_id: job.id, trigger: "manual", environment, created_at: now(), finished_at: now(),
    };
    return { kind: "devstack-static", deployment, previewUrl, dnsReady };
  } catch (e) {
    const reason = e instanceof HostTakenError
      ? `Hostname ${e.host} belongs to another project.`
      : `Publish failed: ${String((e as Error)?.message ?? e).slice(0, 200)}`;
    await appendEvent(db, job.id, { level: "error", phase: state, message: reason }).catch(() => null);
    if (state !== "succeeded") await transitionJob(db, job.id, state, "failed", { error_code: "publish_failed" }, now()).catch(() => null);
    await db.prepare("UPDATE deployments SET status = 'failed', error_code = 'publish_failed', error_log = ?2, finished_at = ?3 WHERE id = ?1")
      .bind(deploymentId, reason, now()).run();
    if (e instanceof HostTakenError) throw new ServiceError("conflict", reason, 409);
    if (e instanceof ServiceError) throw e;
    throw new ServiceError("invalid", reason, 422);
  }
}

/** Point production hostname at a previous live DevStack deployment of the same project. */
export async function rollbackHostingDeployment(
  db: D1Like,
  sites: R2BucketLike | null,
  uid: string,
  deploymentId: string,
  now: () => number = Date.now,
): Promise<{ url: string; deploymentId: string; dnsReady: boolean }> {
  if (!sites) throw new ServiceError("blocked", "R2 SITES binding is not provisioned. / ยังไม่ได้เปิดที่เก็บเว็บ", 503);
  const d = await getDeployment(db, uid, deploymentId);
  if (!d) throw new ServiceError("invalid", "Not found.", 404);
  if (d.target !== "devstack-sites") throw new ServiceError("invalid", "Rollback is only supported for DevStack hosting deployments.", 422);
  if (d.status !== "live") throw new ServiceError("invalid", "Only a live deployment can be promoted. / เลือก deployment ที่ live แล้วเท่านั้น", 409);

  const project = await db.prepare("SELECT * FROM projects WHERE id = ?1 AND user_id = ?2").bind(d.project_id, uid).first<ProjectRow>();
  if (!project) throw new ServiceError("invalid", "Not found.", 404);
  const slug = siteSlug(project.slug || project.name);
  if (!slug) throw new ServiceError("invalid", "Project name cannot be used as a site hostname.", 422);

  try {
    const url = await promoteProduction(sites, slug, project.id, d.id);
    await db.prepare("UPDATE deployments SET alias_url = NULL, environment = 'preview' WHERE project_id = ?1 AND user_id = ?3 AND id != ?2 AND alias_url IS NOT NULL")
      .bind(project.id, d.id, uid).run();
    await db.prepare("UPDATE deployments SET alias_url = ?2, environment = 'production' WHERE id = ?1 AND user_id = ?3")
      .bind(d.id, url, uid).run();
    await audit(db, uid, "deploy.rollback", `${project.slug || project.name}→${d.id.slice(0, 8)}`);
    // Soft signal for timelines: a zero-work "rollback" job marker is optional; keep D1 light.
    void now;
    return { url, deploymentId: d.id, dnsReady: true };
  } catch (e) {
    if (e instanceof HostTakenError) throw new ServiceError("conflict", `Hostname ${e.host} belongs to another project.`, 409);
    throw e;
  }
}
