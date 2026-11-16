/**
 * Per-project environment secrets (D1 `environment_variables`, migration 0014).
 * Values are sealed with CREDENTIALS_KEY; never returned to the client except on write.
 */
import "server-only";
import type { D1Like } from "@/lib/chat/store";
import { open, seal, type SealKeys } from "@/lib/connections/credentials";

export const PROJECT_ENV_NAME = /^[A-Z][A-Z0-9_]{1,63}$/;
export const MAX_PROJECT_ENV_VALUE = 4_000;
export const MAX_PROJECT_ENV_PER_SLOT = 32;

export const PROJECT_ENVIRONMENT = ["preview", "production"] as const;
export type ProjectEnvironment = (typeof PROJECT_ENVIRONMENT)[number];

/** Names reserved on the uploaded user Worker (platform bindings). */
export const RESERVED_WORKER_ENV = new Set(["DEVSTACK_PROXY_KEY", "ASSETS", "AI", "DISPATCHER"]);

export interface ProjectEnvView {
  key: string;
  environment: ProjectEnvironment;
  isSecret: boolean;
  updatedAt: number;
}

const kindOf = (projectId: string) => `env:${projectId}`;

export function validProjectEnvName(name: unknown): name is string {
  return typeof name === "string" && PROJECT_ENV_NAME.test(name) && !RESERVED_WORKER_ENV.has(name);
}

export function validProjectEnvironment(env: unknown): env is ProjectEnvironment {
  return env === "preview" || env === "production";
}

export async function listProjectEnv(
  db: D1Like,
  userId: string,
  projectId: string,
  environment?: ProjectEnvironment,
): Promise<ProjectEnvView[]> {
  const rows = environment
    ? await db
        .prepare(
          "SELECT key, environment, is_secret, updated_at FROM environment_variables WHERE project_id = ?1 AND user_id = ?2 AND environment = ?3 ORDER BY key",
        )
        .bind(projectId, userId, environment)
        .all<{ key: string; environment: string; is_secret: number; updated_at: number }>()
    : await db
        .prepare(
          "SELECT key, environment, is_secret, updated_at FROM environment_variables WHERE project_id = ?1 AND user_id = ?2 ORDER BY environment, key",
        )
        .bind(projectId, userId)
        .all<{ key: string; environment: string; is_secret: number; updated_at: number }>();
  return (rows.results ?? []).flatMap((r) => {
    if (!validProjectEnvironment(r.environment)) return [];
    return [{ key: r.key, environment: r.environment, isSecret: r.is_secret !== 0, updatedAt: r.updated_at }];
  });
}

export async function saveProjectEnv(
  db: D1Like,
  keys: SealKeys,
  userId: string,
  projectId: string,
  environment: ProjectEnvironment,
  key: string,
  value: string,
  now = Date.now(),
): Promise<void> {
  if (!validProjectEnvName(key)) throw new Error("invalid_name");
  if (!value || value.length > MAX_PROJECT_ENV_VALUE) throw new Error("invalid_value");
  const count = await db
    .prepare("SELECT COUNT(*) AS n FROM environment_variables WHERE project_id = ?1 AND user_id = ?2 AND environment = ?3 AND key != ?4")
    .bind(projectId, userId, environment, key)
    .first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_PROJECT_ENV_PER_SLOT) throw new Error("too_many");
  const enc = await seal(keys, kindOf(projectId), userId, value);
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO environment_variables (id, project_id, user_id, environment, key, value_enc, is_secret, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7)
       ON CONFLICT (project_id, environment, key) DO UPDATE SET value_enc = excluded.value_enc, updated_at = excluded.updated_at, user_id = excluded.user_id`,
    )
    .bind(id, projectId, userId, environment, key, enc, now)
    .run();
}

export async function deleteProjectEnv(
  db: D1Like,
  userId: string,
  projectId: string,
  environment: ProjectEnvironment,
  key: string,
): Promise<boolean> {
  if (!validProjectEnvName(key)) return false;
  await db
    .prepare("DELETE FROM environment_variables WHERE project_id = ?1 AND user_id = ?2 AND environment = ?3 AND key = ?4")
    .bind(projectId, userId, environment, key)
    .run();
  return true;
}

/** Plaintext map for build container and Worker secret_text bindings (job environment). */
export async function loadProjectEnvPlain(db: D1Like, keys: SealKeys, projectId: string, userId: string, environment: string): Promise<Record<string, string>> {
  if (!validProjectEnvironment(environment)) return {};
  const rows = await db
    .prepare("SELECT key, value_enc FROM environment_variables WHERE project_id = ?1 AND user_id = ?2 AND environment = ?3")
    .bind(projectId, userId, environment)
    .all<{ key: string; value_enc: string }>();
  const out: Record<string, string> = {};
  for (const r of rows.results ?? []) {
    if (!validProjectEnvName(r.key)) continue;
    const v = await open(keys, kindOf(projectId), userId, r.value_enc).catch(() => null);
    if (v) out[r.key] = v.value;
  }
  return out;
}

/** Cloudflare upload metadata bindings for SSR runtime. */
export function workerSecretBindingsFromEnv(env: Record<string, string>): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const [name, text] of Object.entries(env)) {
    if (!validProjectEnvName(name) || !text) continue;
    out.push({ type: "secret_text", name, text });
  }
  return out;
}