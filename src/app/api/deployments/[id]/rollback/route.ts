import { connection } from "next/server";
import { json } from "@/lib/chat/runtime";
import { serviceErrorBody } from "@/lib/connections/github-service";
import { gate, isResponse } from "@/lib/connections/route-kit";
import { routeBuildBindings } from "@/lib/build/bindings";
import { getDeployment } from "@/lib/deploy/service";
import { rollbackHostingDeployment } from "@/lib/hosting/deploy";

type Ctx = { params: Promise<{ id: string }> };

/** POST /api/deployments/:id/rollback — promote this live DevStack deployment to production. */
export async function POST(req: Request, ctx: Ctx) {
  await connection();
  const a = await gate(req, { write: true, burstKey: "dep-rollback", perMinute: 6 });
  if (isResponse(a)) return a;
  const id = (await ctx.params).id;
  const d = await getDeployment(a.db, a.uid, id);
  if (!d) return json({ error: "Not found.", code: "not_found" }, 404);
  try {
    const builds = await routeBuildBindings();
    const r = await rollbackHostingDeployment(a.db, builds.sites, a.uid, id);
    return json({ ok: true, url: r.url, deploymentId: r.deploymentId, dnsReady: r.dnsReady });
  } catch (err) {
    const e = serviceErrorBody(err);
    return json(e.body, e.status);
  }
}
