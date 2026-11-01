import "server-only";
import { limitsForUser } from "@/lib/limits/tiers";
import { templateBuild } from "@/lib/projects/template-seed";
import {
  commitFiles,
  createBranch,
  getBranchSha,
  GithubApiError,
  openPullRequest,
  type FileChange,
  type PullSummary,
} from "@/lib/auth/github-api";
import { consume, customerRules } from "@/lib/chat/limits";
import type { D1Like } from "@/lib/chat/store";
import { saveProjectFiles } from "@/lib/deploy/upload";
import { putProjectSource } from "@/lib/hosting/sources";
import { audit } from "./audit";
import { LIMITS, changeBranchName, safeRepoName } from "./policy";
import { insertProject, type ProjectRow } from "./projects";
import { assertSlugUsable } from "@/lib/projects/slug-gate";
import { siteSlug } from "@/lib/hosting/hostnames";
import type { R2BucketLike } from "@/lib/hosting/serve";

export class ServiceError extends Error {
  constructor(
    public code: "rate_limited" | "invalid" | "reauth" | "github" | "conflict" | "forbidden" | "limit" | "blocked",
    message: string,
    public status = 400
  ) {
    super(message);
  }
}

const RULES = { repo: LIMITS.reposPerDay, pr: LIMITS.prsPerDay, deploy: LIMITS.deploysPerDay };

export async function takeQuota(db: D1Like, uid: string, kind: "repo" | "pr" | "deploy"): Promise<void> {
  // Deploys follow the user's tier; repo/PR caps stay capacity-derived (GitHub secondary limits).
  const rules = kind === "deploy" ? { ...RULES, deploy: (await limitsForUser(db, uid)).deploysPerDay } : RULES;
  const r = await consume(db, customerRules(uid, kind, rules));
  if (!r.ok) throw new ServiceError("rate_limited", `Daily ${kind} limit reached (${rules[kind]}/day). Resets at midnight Bangkok time. / ครบโควตา ${kind} ของวันนี้แล้ว`, 429);
}

/**
 * DISABLED: creating GitHub repos from DevStack caused account spam bans under load.
 * Hosting path uses {@link createHostedProject} (R2 + D1 only). This stub keeps call sites
 * failing closed with no GitHub API traffic.
 */
export async function createProjectRepo(
  db: D1Like,
  _token: string,
  uid: string,
  spec: { name: string; private: boolean; templateId?: string | null; description?: string; files?: FileChange[] },
  sites: R2BucketLike | null = null
): Promise<{ project: ProjectRow; htmlUrl: string; commit?: string }> {
  const name = safeRepoName(spec.name);
  if (!name) throw new ServiceError("invalid", "Repository name is invalid. / ชื่อ repo ไม่ถูกต้อง");
  const slug = siteSlug(name);
  if (slug) await assertSlugUsable(db, slug, null, sites);
  void uid;
  throw new ServiceError(
    "forbidden",
    "Creating GitHub repositories from DevStack is disabled. New projects stay on DevStack hosting (R2) — use create hosted project / import an existing repo. / ปิดการสร้าง repo บน GitHub แล้ว",
    403,
  );
}

/** Create a DevStack-hosted project with optional template files. No GitHub create/push/clone. */
export async function createHostedProject(
  db: D1Like,
  uid: string,
  spec: { name: string; templateId?: string | null; description?: string; files?: FileChange[] },
  sites: R2BucketLike | null = null,
): Promise<{ project: ProjectRow; sourceSha: string | null }> {
  const name = safeRepoName(spec.name);
  if (!name) throw new ServiceError("invalid", "Project name is invalid. / ชื่อโปรเจกต์ไม่ถูกต้อง");
  const slug = siteSlug(name);
  if (slug) await assertSlugUsable(db, slug, null, sites);
  const count = await db.prepare("SELECT COUNT(*) AS n FROM projects WHERE user_id = ?1").bind(uid).first<{ n: number }>();
  if (Number(count?.n ?? 0) >= 100) throw new ServiceError("limit", "Project limit reached (100).", 409);
  const id = crypto.randomUUID();
  const templateId = spec.templateId ?? null;
  const project: ProjectRow = {
    id, user_id: uid, name, template_id: templateId, repo_full_name: null, default_branch: null,
    created_at: Date.now(), slug, source: "hosted", provider: "devstack-sites",
  };
  await insertProject(db, {
    id, userId: uid, name, templateId, repo: null, branch: null,
    build: templateId ? templateBuild(templateId) : null, slug,
  });
  await db.prepare("UPDATE projects SET source = 'hosted', provider = 'devstack-sites' WHERE id = ?1 AND user_id = ?2").bind(id, uid).run().catch(() => null);
  let sourceSha: string | null = null;
  if (spec.files?.length) {
    const bundle = spec.files
      .filter((f) => f.content !== null && typeof f.path === "string")
      .map((f) => ({ path: f.path, bytes: new TextEncoder().encode(f.content as string) }));
    if (bundle.length) {
      await saveProjectFiles(db, id, bundle);
      if (sites) {
        const put = await putProjectSource(sites, id, bundle);
        sourceSha = put.sha256;
      }
    }
  }
  await audit(db, uid, "project.created", `hosted:${id}`);
  void spec.description;
  return { project, sourceSha };
}

/** Branch from base, commit all files in one Git Data commit, open a PR. The default branch is never written directly. */
export async function proposeChanges(
  db: D1Like,
  token: string,
  uid: string,
  spec: { owner: string; repo: string; base: string; branch?: string; title: string; body: string; files: FileChange[] }
): Promise<{ branch: string; commit: string; pr: PullSummary }> {
  const branch = spec.branch ?? changeBranchName(spec.title);
  if (branch === spec.base) throw new ServiceError("invalid", "Changes go to a new branch, not the base branch. / ต้อง commit ลงสาขาใหม่ ไม่ใช่สาขาหลัก");
  await takeQuota(db, uid, "pr");
  await createBranch(token, spec.owner, spec.repo, branch, spec.base);
  const c = await commitFiles(token, { owner: spec.owner, repo: spec.repo, branch, message: spec.title, files: spec.files });
  const pr = await openPullRequest(token, { owner: spec.owner, repo: spec.repo, head: branch, base: spec.base, title: spec.title, body: `${spec.body}\n\n_Opened by DevStack on your behalf._` });
  await audit(db, uid, "pr.opened", `${spec.owner}/${spec.repo}#${pr.number}`);
  return { branch, commit: c.sha, pr };
}

/** Commit to an existing non-default branch (used by chat edits and self-heal fixes). */
export async function commitToBranch(
  token: string,
  spec: { owner: string; repo: string; branch: string; defaultBranch: string; message: string; files: FileChange[]; createFrom?: string }
): Promise<{ sha: string; url: string }> {
  if (spec.branch === spec.defaultBranch) throw new ServiceError("invalid", "Direct commits to the default branch are blocked; use a branch and a PR. / ห้าม commit ตรงเข้าสาขาหลัก");
  if (!(await getBranchSha(token, spec.owner, spec.repo, spec.branch))) await createBranch(token, spec.owner, spec.repo, spec.branch, spec.createFrom ?? spec.defaultBranch);
  return commitFiles(token, spec);
}

export function serviceErrorBody(err: unknown): { status: number; body: { error: string; code: string } } {
  if (err instanceof ServiceError) return { status: err.status, body: { error: err.message, code: err.code } };
  if (err instanceof GithubApiError) {
    if (err.status === 401) return { status: 401, body: { error: "GitHub rejected the saved sign-in. Reconnect GitHub. / กรุณาเชื่อมต่อ GitHub ใหม่", code: "reauth" } };
    return { status: err.status === 404 || err.status === 409 || err.status === 422 ? err.status : 502, body: { error: err.message, code: "github" } };
  }
  return { status: 502, body: { error: "Request failed. / ทำรายการไม่สำเร็จ", code: "internal" } };
}
