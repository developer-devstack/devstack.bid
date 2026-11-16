import { connection } from "next/server";
import { cursorInstallToken, loadCursorOriginServer } from "@/lib/auth/cursor-origin-server";
import { json } from "@/lib/chat/runtime";
import { serviceErrorBody } from "@/lib/connections/github-service";
import { loadOwnedProject } from "@/lib/connections/projects";
import { gate, isResponse } from "@/lib/connections/route-kit";
import { routeBuildBindings } from "@/lib/build/bindings";
import { startContainerBuild } from "@/lib/build/executor";
import { syncCursorProject } from "@/lib/projects/sync-cursor";
import { HttpError, readJsonBody } from "@/lib/server/http";

/** POST /api/projects/:id/sync-cursor — pull latest Origin snapshot and queue a production build. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await ctx.params;
  const a = await gate(req, { write: true, burstKey: "proj-sync-cursor", perMinute: 6 });
  if (isResponse(a)) return a;
  const srv = await loadCursorOriginServer(a.db, a.uid);
  if (!srv) return json({ error: "Cursor installation missing. Sign in with Cursor again.", code: "reauth" }, 401);
  const project = await loadOwnedProject(a.db, a.uid, id);
  if (!project) return json({ error: "Project not found.", code: "not_found" }, 404);
  let body: Record<string, unknown> = {};
  try {
    body = ((await readJsonBody(req, 2_000)) ?? {}) as Record<string, unknown>;
  } catch (err) {
    return json({ error: err instanceof HttpError ? err.message : "Bad request", code: "invalid" }, err instanceof HttpError ? err.status : 400);
  }
  const branch = typeof body.branch === "string" ? body.branch : undefined;
  try {
    const conn = await a.db
      .prepare("SELECT repo_id FROM project_connections WHERE project_id = ?1 AND provider = 'cursor' LIMIT 1")
      .bind(id)
      .first<{ repo_id: string | null }>();
    const repoIds = conn?.repo_id ? [conn.repo_id] : undefined;
    const token = await cursorInstallToken(srv, ["repository:contents:read"], repoIds);
    const bindings = await routeBuildBindings();
    const synced = await syncCursorProject(a.db, project, token, bindings.sites, branch);
    let build: Record<string, unknown>;
    try {
      const b = await startContainerBuild(a.db, a.keys, bindings, a.uid, project, { environment: "production" });
      build = { status: "queued", jobId: b.job.id, deploymentId: b.deploymentId, previewUrl: b.previewUrl, productionUrl: b.productionUrl };
    } catch (err) {
      const e = serviceErrorBody(err);
      build = { status: (e.body as { code?: string }).code === "blocked" ? "blocked" : "not_started", ...e.body };
    }
    return json({ ok: true, synced, build }, 200);
  } catch (err) {
    const e = serviceErrorBody(err);
    return json(e.body, e.status);
  }
}
