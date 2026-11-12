import { connection } from "next/server";
import { cursorInstallToken, loadCursorOriginServer } from "@/lib/auth/cursor-origin-server";
import { json } from "@/lib/chat/runtime";
import { getAccount } from "@/lib/chat/store";
import { serviceErrorBody } from "@/lib/connections/github-service";
import { projectView } from "@/lib/connections/projects";
import { gate, isResponse } from "@/lib/connections/route-kit";
import { routeBuildBindings } from "@/lib/build/bindings";
import { startContainerBuild } from "@/lib/build/executor";
import { importCursorRepo } from "@/lib/projects/import-cursor";
import { HttpError, readJsonBody } from "@/lib/server/http";

/** POST /api/projects/import-cursor — snapshot an Origin repo to R2 and queue a production build. */
export async function POST(req: Request) {
  await connection();
  const a = await gate(req, { write: true, burstKey: "proj-import-cursor", perMinute: 4 });
  if (isResponse(a)) return a;
  const account = await getAccount(a.db, a.uid);
  if (account?.provider !== "cursor") return json({ error: "Sign in with Cursor first.", code: "reauth" }, 401);
  const srv = await loadCursorOriginServer(a.db, a.uid);
  if (!srv) return json({ error: "Cursor installation missing. Sign in with Cursor again.", code: "reauth" }, 401);
  let body: Record<string, unknown>;
  try {
    body = ((await readJsonBody(req, 8_000)) ?? {}) as Record<string, unknown>;
  } catch (err) {
    return json({ error: err instanceof HttpError ? err.message : "Bad request", code: "invalid" }, err instanceof HttpError ? err.status : 400);
  }
  try {
    const token = await cursorInstallToken(srv, ["repository:contents:read"], typeof body.repoId === "string" ? [body.repoId] : undefined);
    const p = await importCursorRepo(a.db, a.uid, token, body, (await routeBuildBindings()).sites);
    let build: Record<string, unknown>;
    try {
      const b = await startContainerBuild(a.db, a.keys, await routeBuildBindings(), a.uid, p, { environment: "production" });
      build = { status: "queued", jobId: b.job.id, deploymentId: b.deploymentId, previewUrl: b.previewUrl, productionUrl: b.productionUrl };
    } catch (err) {
      const e = serviceErrorBody(err);
      build = { status: (e.body as { code?: string }).code === "blocked" ? "blocked" : "not_started", ...e.body };
    }
    return json({ ok: true, project: projectView(p), build }, 201);
  } catch (err) {
    const e = serviceErrorBody(err);
    return json(e.body, e.status);
  }
}
