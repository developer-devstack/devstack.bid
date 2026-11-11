/**
 * User-owned hostnames on the devstack-sites Worker (Workers Custom Domain + R2 router index).
 * Zone for the hostname must live on the same Cloudflare account as SITES_CF_* (SSL is issued by Cloudflare).
 */
import "server-only";
import type { D1Like } from "@/lib/chat/store";
import { PLATFORM_DOMAIN, parseHost } from "./hostnames";
import type { R2BucketLike } from "./serve";
import { resolveServerWorker } from "./serve";
import { siteSlug } from "./hostnames";
import { CfApiError, type CfApi } from "./server-worker";
import { customHostKey, deleteCustomHostRecord, normalizeHostname, writeCustomHostRecord } from "./custom-host-r2";
import { assertPlatformDomainCapacity, maxDomainsPerProject } from "./domain-policy";
import { audit } from "@/lib/connections/audit";

export const SITES_ROUTER_SERVICE = "devstack-sites";
export { customHostKey, normalizeHostname, writeCustomHostRecord, deleteCustomHostRecord };
/** @deprecated use maxDomainsPerProject() from domain-policy */
export const MAX_CUSTOM_DOMAINS_PER_PROJECT = 3;
export const VERIFY_LABEL = "_devstack-challenge";

export type CustomDomainStatus = "pending" | "active" | "error" | "removed";

export interface CustomDomainRow {
  id: string;
  project_id: string;
  user_id: string;
  hostname: string;
  status: CustomDomainStatus;
  verify_token: string;
  cf_domain_id: string | null;
  error_message: string | null;
  created_at: number;
  verified_at: number | null;
}

const FQDN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** Reject platform hosts, wildcards, IPs, and devstack.bid labels. */
export function validateCustomHostname(host: string, platformDomain = PLATFORM_DOMAIN): string | null {
  const h = normalizeHostname(host);
  if (!h || h.length > 253 || !FQDN.test(h)) return null;
  if (h === platformDomain || h.endsWith(`.${platformDomain}`)) return null;
  if (h.includes("*") || h.includes("_")) return null;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return null;
  const parsed = parseHost(h, platformDomain);
  if (parsed.kind !== "foreign") return null;
  return h;
}

export function challengeRecordName(hostname: string): string {
  const h = normalizeHostname(hostname);
  return `${VERIFY_LABEL}.${h}`;
}

async function cfCall<T>(api: CfApi, path: string, init: RequestInit): Promise<T> {
  const f = api.fetcher ?? fetch;
  const res = await f(`https://api.cloudflare.com/client/v4/accounts/${api.accountId}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${api.token}`, ...(init.headers ?? {}) },
  });
  const body = (await res.json().catch(() => null)) as { success?: boolean; result?: T; errors?: { code?: number; message?: string }[] } | null;
  if (!res.ok || !body?.success) {
    const e = body?.errors?.[0];
    throw new CfApiError(res.status, typeof e?.code === "number" ? e.code : null, String(e?.message ?? "").slice(0, 300));
  }
  return body.result as T;
}

export async function attachSitesCustomDomain(api: CfApi, hostname: string): Promise<{ id: string }> {
  return cfCall(api, "/workers/domains", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hostname, service: SITES_ROUTER_SERVICE, environment: "production" }),
  });
}

export async function detachSitesCustomDomain(api: CfApi, domainId: string): Promise<void> {
  await cfCall(api, `/workers/domains/${encodeURIComponent(domainId)}`, { method: "DELETE" });
}

/** TXT at _devstack-challenge.<hostname> must include the verify token (substring match). */
export async function dnsTxtContainsToken(hostname: string, token: string, fetcher: typeof fetch = fetch): Promise<boolean> {
  const name = challengeRecordName(hostname);
  const url = `https://dns.google/resolve?name=${encodeURIComponent(name)}&type=TXT`;
  const res = await fetcher(url, { headers: { accept: "application/dns-json" } });
  if (!res.ok) return false;
  const data = (await res.json().catch(() => null)) as { Answer?: { data?: string }[] } | null;
  const answers = data?.Answer ?? [];
  const needle = token.replace(/"/g, "");
  return answers.some((a) => String(a.data ?? "").replace(/"/g, "").includes(needle));
}

export function newDomainId(): string {
  return crypto.randomUUID();
}

export function newVerifyToken(): string {
  const b = new Uint8Array(18);
  crypto.getRandomValues(b);
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function listProjectCustomDomains(db: D1Like, projectId: string, uid: string): Promise<CustomDomainRow[]> {
  const { results } = await db
    .prepare(
      "SELECT id, project_id, user_id, hostname, status, verify_token, cf_domain_id, error_message, created_at, verified_at FROM project_custom_domains WHERE project_id = ?1 AND user_id = ?2 AND status != 'removed' ORDER BY created_at ASC",
    )
    .bind(projectId, uid)
    .all<CustomDomainRow>();
  return results ?? [];
}

export async function countProjectCustomDomains(db: D1Like, projectId: string): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM project_custom_domains WHERE project_id = ?1 AND status != 'removed'")
    .bind(projectId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function getCustomDomain(db: D1Like, id: string, uid: string): Promise<CustomDomainRow | null> {
  return db
    .prepare(
      "SELECT id, project_id, user_id, hostname, status, verify_token, cf_domain_id, error_message, created_at, verified_at FROM project_custom_domains WHERE id = ?1 AND user_id = ?2 AND status != 'removed'",
    )
    .bind(id, uid)
    .first<CustomDomainRow>();
}

export async function insertCustomDomain(
  db: D1Like,
  row: Pick<CustomDomainRow, "id" | "project_id" | "user_id" | "hostname" | "status" | "verify_token" | "created_at">,
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO project_custom_domains (id, project_id, user_id, hostname, status, verify_token, cf_domain_id, error_message, created_at, verified_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, NULL, ?7, NULL)",
    )
    .bind(row.id, row.project_id, row.user_id, row.hostname, row.status, row.verify_token, row.created_at)
    .run();
}

export async function markCustomDomain(db: D1Like, id: string, patch: Partial<Pick<CustomDomainRow, "status" | "cf_domain_id" | "error_message" | "verified_at">>): Promise<void> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  if (patch.status !== undefined) { sets.push(`status = ?${i++}`); vals.push(patch.status); }
  if (patch.cf_domain_id !== undefined) { sets.push(`cf_domain_id = ?${i++}`); vals.push(patch.cf_domain_id); }
  if (patch.error_message !== undefined) { sets.push(`error_message = ?${i++}`); vals.push(patch.error_message); }
  if (patch.verified_at !== undefined) { sets.push(`verified_at = ?${i++}`); vals.push(patch.verified_at); }
  if (!sets.length) return;
  vals.push(id);
  await db.prepare(`UPDATE project_custom_domains SET ${sets.join(", ")} WHERE id = ?${i}`).bind(...vals).run();
}

export async function removeCustomDomainRow(db: D1Like, id: string, uid: string): Promise<CustomDomainRow | null> {
  const row = await getCustomDomain(db, id, uid);
  if (!row) return null;
  await db.prepare("UPDATE project_custom_domains SET status = 'removed' WHERE id = ?1").bind(id).run();
  return row;
}

/** After production promote / server publish, mirror active custom domains in R2. */
export async function syncActiveCustomDomains(
  db: D1Like,
  bucket: R2BucketLike,
  projectId: string,
  deploymentId: string,
  worker?: string,
): Promise<void> {
  const { results } = await db
    .prepare("SELECT hostname FROM project_custom_domains WHERE project_id = ?1 AND status = 'active'")
    .bind(projectId)
    .all<{ hostname: string }>();
  await Promise.all(
    (results ?? []).map((row) => writeCustomHostRecord(bucket, row.hostname, projectId, deploymentId, worker)),
  );
}

export function makeCustomDomainSync(
  db: D1Like,
  bucket: R2BucketLike,
  projectId: string,
  deploymentId: string,
  worker?: string,
): () => Promise<void> {
  return () => syncActiveCustomDomains(db, bucket, projectId, deploymentId, worker);
}

export async function latestProductionDeploymentId(db: D1Like, projectId: string): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT id FROM deployments WHERE project_id = ?1 AND target = 'devstack-sites' AND status = 'live'
       AND (environment = 'production' OR alias_url IS NOT NULL) ORDER BY COALESCE(finished_at, created_at) DESC LIMIT 1`,
    )
    .bind(projectId)
    .first<{ id: string }>();
  return row?.id ?? null;
}

export async function hostnameTaken(db: D1Like, hostname: string, projectId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT project_id FROM project_custom_domains WHERE hostname = ?1 AND status != 'removed' LIMIT 1")
    .bind(normalizeHostname(hostname))
    .first<{ project_id: string }>();
  return !!row && row.project_id !== projectId;
}

export async function addProjectCustomDomain(db: D1Like, uid: string, projectId: string, hostname: string): Promise<CustomDomainRow> {
  const h = validateCustomHostname(hostname);
  if (!h) throw new Error("invalid_hostname");
  if (await hostnameTaken(db, h, projectId)) throw new Error("hostname_taken");
  if ((await countProjectCustomDomains(db, projectId)) >= maxDomainsPerProject()) throw new Error("domain_limit");
  const row: CustomDomainRow = {
    id: newDomainId(),
    project_id: projectId,
    user_id: uid,
    hostname: h,
    status: "pending",
    verify_token: newVerifyToken(),
    cf_domain_id: null,
    error_message: null,
    created_at: Date.now(),
    verified_at: null,
  };
  await insertCustomDomain(db, row);
  await audit(db, uid, "domain.pending", h);
  return row;
}

export async function verifyProjectCustomDomain(
  db: D1Like,
  bucket: R2BucketLike,
  api: CfApi | null,
  uid: string,
  domainId: string,
  fetcher: typeof fetch = fetch,
): Promise<CustomDomainRow> {
  const row = await getCustomDomain(db, domainId, uid);
  if (!row) throw new Error("not_found");
  if (row.status === "active") return row;
  const ok = await dnsTxtContainsToken(row.hostname, row.verify_token, fetcher);
  if (!ok) throw new Error("verify_failed");
  if (!api?.token) throw new Error("cf_not_configured");
  await assertPlatformDomainCapacity(db, uid);
  try {
    const attached = await attachSitesCustomDomain(api, row.hostname);
    const deploymentId = await latestProductionDeploymentId(db, row.project_id);
    if (!deploymentId) throw new Error("no_production_deployment");
    const proj = await db.prepare("SELECT slug, name FROM projects WHERE id = ?1").bind(row.project_id).first<{ slug: string | null; name: string }>();
    const slug = proj ? siteSlug(proj.slug || proj.name) : null;
    const worker = slug ? await resolveServerWorker(bucket, slug) : null;
    await markCustomDomain(db, row.id, { status: "active", cf_domain_id: attached.id, verified_at: Date.now(), error_message: null });
    await writeCustomHostRecord(bucket, row.hostname, row.project_id, deploymentId, worker ?? undefined);
    await audit(db, uid, "domain.active", row.hostname);
    return { ...row, status: "active", cf_domain_id: attached.id, verified_at: Date.now(), error_message: null };
  } catch (e) {
    const msg = e instanceof CfApiError ? e.detail : String((e as Error)?.message ?? e).slice(0, 200);
    await markCustomDomain(db, row.id, { status: "error", error_message: msg });
    await audit(db, uid, "domain.error", `${row.hostname}:${msg.slice(0, 80)}`);
    throw e;
  }
}

export async function removeProjectCustomDomain(
  db: D1Like,
  bucket: R2BucketLike,
  api: CfApi | null,
  uid: string,
  domainId: string,
): Promise<void> {
  const row = await removeCustomDomainRow(db, domainId, uid);
  if (!row) throw new Error("not_found");
  await deleteCustomHostRecord(bucket, row.hostname);
  if (row.cf_domain_id && api?.token) {
    try {
      await detachSitesCustomDomain(api, row.cf_domain_id);
    } catch {
      /* detach best-effort */
    }
  }
  await audit(db, uid, "domain.removed", row.hostname);
}
