import { connection } from "next/server";
import { json } from "@/lib/chat/runtime";
import { getProject } from "@/lib/connections/projects";
import { gate, isResponse } from "@/lib/connections/route-kit";
import { deleteProjectEnv, validProjectEnvironment, validProjectEnvName } from "@/lib/projects/project-env";

/** DELETE /api/projects/:id/env/:key?environment=production|preview */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string; key: string }> }) {
  await connection();
  const a = await gate(req, { write: true, burstKey: "proj-env-del", perMinute: 30 });
  if (isResponse(a)) return a;
  const { id, key: rawKey } = await ctx.params;
  const key = decodeURIComponent(rawKey).trim().toUpperCase();
  if (!validProjectEnvName(key)) return json({ error: "Invalid key.", code: "invalid" }, 400);
  const p = await getProject(a.db, a.uid, id);
  if (!p) return json({ error: "Not found. / ไม่พบโปรเจกต์", code: "not_found" }, 404);
  const url = new URL(req.url);
  const envRaw = url.searchParams.get("environment") ?? "production";
  if (!validProjectEnvironment(envRaw)) return json({ error: "environment must be preview or production", code: "invalid" }, 400);
  await deleteProjectEnv(a.db, a.uid, id, envRaw, key);
  return json({ ok: true, key, environment: envRaw }, 200);
}