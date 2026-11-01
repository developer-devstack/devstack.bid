import { connection } from "next/server";
import { chatRuntime, json } from "@/lib/chat/runtime";
import { serviceErrorBody } from "@/lib/connections/github-service";
import { getProject } from "@/lib/connections/projects";
import { audit } from "@/lib/connections/audit";
import { saveCredential, type CredentialMeta } from "@/lib/connections/credentials";
import { ERROR_TEXT, gate, isResponse } from "@/lib/connections/route-kit";
import { validateCloudflare } from "@/lib/connections/validate";
import { routeBuildBindings } from "@/lib/build/bindings";
import { deploymentView, listDeployments } from "@/lib/deploy/service";
import { startHostingDeploy, type HostingTarget } from "@/lib/hosting/deploy";
import { HttpError, readJsonBody } from "@/lib/server/http";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/projects/:id/deploy — deployment timeline. */
export async function GET(req: Request, ctx: Ctx) {
  await connection();
  const a = await gate(req, { write: false, burstKey: "dep-list", perMinute: 60, bearer: true });
  if (isResponse(a)) return a;
  const p = await getProject(a.db, a.uid, (await ctx.params).id);
  if (!p) return json({ error: "Not found. / ไม่พบโปรเจกต์", code: "not_found" }, 404);
  return json({ deployments: (await listDeployments(a.db, a.uid, p.id)).map(deploymentView) }, 200, { "Cache-Control": "no-store" });
}

/**
 * POST /api/projects/:id/deploy
 * Body: { ref?, target?: "devstack"|"cloudflare", environment?: "preview"|"production", token?, accountId?, remember? }
 * Default target = devstack (*.devstack.bid). Cloudflare is optional (connection or one-shot token).
 */
export async function POST(req: Request, ctx: Ctx) {
  await connection();
  const a = await gate(req, { write: true, burstKey: "dep-new", perMinute: 4 });
  if (isResponse(a)) return a;
  const p = await getProject(a.db, a.uid, (await ctx.params).id);
  if (!p) return json({ error: "Not found. / ไม่พบโปรเจกต์", code: "not_found" }, 404);
  let body: { ref?: unknown; target?: unknown; environment?: unknown; token?: unknown; accountId?: unknown; remember?: unknown };
  try {
    body = ((await readJsonBody(req, 4_000)) ?? {}) as typeof body;
  } catch (err) {
    return json({ error: err instanceof HttpError ? err.message : "Bad request", code: "invalid" }, err instanceof HttpError ? err.status : 400);
  }
  let once: { secret: string; meta: CredentialMeta } | null = null;
  if (typeof body.token === "string" && body.token.trim()) {
    const secret = body.token.trim();
    const v = await validateCloudflare(secret, String(body.accountId ?? "").trim().toLowerCase());
    if (!v.ok) return json({ error: ERROR_TEXT[v.code], code: v.code }, v.code === "provider_unavailable" ? 502 : 400);
    if (body.remember === true) {
      await saveCredential(a.db, a.keys, a.uid, "cloudflare", secret, v.meta);
      await audit(a.db, a.uid, "credential.saved", "cloudflare");
    }
    once = { secret, meta: v.meta };
  }
  const target: HostingTarget | null =
    body.target === "cloudflare" || once ? "cloudflare" : body.target === "devstack" ? "devstack" : "devstack";
  const environment = body.environment === "production" ? "production" : "preview";
  const { waitUntil } = await chatRuntime();
  try {
    const r = await startHostingDeploy(a.db, a.keys, await routeBuildBindings(), a.uid, p, {
      ref: typeof body.ref === "string" ? body.ref : null,
      target,
      environment,
      once,
      waitUntil,
      trigger: "redeploy",
    });
    return json({
      ok: true,
      target: r.kind.startsWith("devstack") ? "devstack" : "cloudflare",
      deployment: deploymentView(r.deployment),
      previewUrl: r.kind === "devstack-build" ? r.previewUrl : r.kind === "devstack-static" ? r.previewUrl : r.deployment.url,
      productionUrl: r.kind === "devstack-build" ? r.productionUrl : null,
    }, 202);
  } catch (err) {
    const e = serviceErrorBody(err);
    return json(e.body, e.status);
  }
}
