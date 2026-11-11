/**
 * Optional Workers bindings injected at SSR upload time (whitelist only — no platform D1/R2).
 */
import "server-only";
import type { D1Like } from "@/lib/chat/store";

export type ServerBindingSpec = {
  /** Workers AI binding (`AI`) — uses platform account inference; subject to DevStack quotas. */
  ai?: boolean;
};

const DEFAULT_SPEC: ServerBindingSpec = {};

export function parseServerBindings(json: string | null | undefined): ServerBindingSpec {
  if (!json?.trim()) return { ...DEFAULT_SPEC };
  try {
    const raw = JSON.parse(json) as Record<string, unknown>;
    const spec: ServerBindingSpec = {};
    if (raw.ai === true) spec.ai = true;
    return spec;
  } catch {
    return { ...DEFAULT_SPEC };
  }
}

/** Cloudflare upload `metadata.bindings` entries (appended after guard + assets). */
export function workerBindingsFromSpec(spec: ServerBindingSpec): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  if (spec.ai) out.push({ type: "ai", name: "AI" });
  return out;
}

export interface ProjectServerBindingsRow {
  project_id: string;
  user_id: string;
  bindings_json: string;
  updated_at: number;
}

export async function getProjectServerBindings(db: D1Like, projectId: string, uid: string): Promise<ServerBindingSpec> {
  const row = await db
    .prepare("SELECT bindings_json FROM project_server_bindings WHERE project_id = ?1 AND user_id = ?2")
    .bind(projectId, uid)
    .first<{ bindings_json: string }>();
  return parseServerBindings(row?.bindings_json);
}

export async function setProjectServerBindings(db: D1Like, projectId: string, uid: string, spec: ServerBindingSpec): Promise<ServerBindingSpec> {
  const clean: ServerBindingSpec = {};
  if (spec.ai === true) clean.ai = true;
  const json = JSON.stringify(clean);
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO project_server_bindings (project_id, user_id, bindings_json, updated_at) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(project_id) DO UPDATE SET bindings_json = excluded.bindings_json, updated_at = excluded.updated_at, user_id = excluded.user_id`,
    )
    .bind(projectId, uid, json, now)
    .run();
  return clean;
}

export async function loadProjectServerBindings(db: D1Like, projectId: string): Promise<ServerBindingSpec> {
  const row = await db.prepare("SELECT bindings_json FROM project_server_bindings WHERE project_id = ?1").bind(projectId).first<{ bindings_json: string }>();
  return parseServerBindings(row?.bindings_json);
}
