import { connection } from "next/server";
import { json } from "@/lib/chat/runtime";
import { serviceErrorBody } from "@/lib/connections/github-service";
import { getProject } from "@/lib/connections/projects";
import { gate, isResponse } from "@/lib/connections/route-kit";
import { routeBuildBindings } from "@/lib/build/bindings";
import { getDeployment } from "@/lib/deploy/service";
import { rollbackHostingDeployment } from "@/lib/hosting/deploy";
import { HttpError, readJsonBody } from "@/lib/server/http";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/projects/:id/rollback { deploymentId }
 * Promote a previous live DevStack hosting deployment to the production hostname.
 */
export async function POST(req: Request, ctx: Ctx) {
  await connection();
  const a = await gate(req, { write: true, burstKey: "dep-rollback", perMinute: 6 });
  if (isResponse(a)) return a;
  const p = await getProject(a.db, a.uid, (await ctx.params).id);
  if (!p) return json({ error: "Not found. / ไม่พบโปรเจกต์", code: "not_found" }, 404);
  let body: { deploymentId?: unknown };
  try {
    body = ((await readJsonBody(req, 2_000)) ?? {}) as typeof body;
  } catch (err) {
    return json({ error: err instanceof HttpError ? err.message : "Bad request", code: "invalid" }, err instanceof HttpError ? err.status : 400);
  }
  const deploymentId = typeof body.deploymentId === "string" ? body.deploymentId.trim() : "";
  if (!deploymentId) return json({ error: "deploymentId required", code: "invalid" }, 400);
  const d = await getDeployment(a.db, a.uid, deploymentId);
  if (!d || d.project_id !== p.id) return json({ error: "Not found.", code: "not_found" }, 404);
  try {
    const builds = await routeBuildBindings();
    const r = await rollbackHostingDeployment(a.db, builds.sites, a.uid, deploymentId);
    return json({ ok: true, url: r.url, deploymentId: r.deploymentId, dnsReady: r.dnsReady });
  } catch (err) {
    const e = serviceErrorBody(err);
    return json(e.body, e.status);
  }
}
