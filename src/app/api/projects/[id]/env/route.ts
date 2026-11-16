import { connection } from "next/server";
import { json } from "@/lib/chat/runtime";
import { getProject } from "@/lib/connections/projects";
import { gate, isResponse } from "@/lib/connections/route-kit";
import {
  listProjectEnv,
  saveProjectEnv,
  validProjectEnvironment,
  validProjectEnvName,
  type ProjectEnvironment,
} from "@/lib/projects/project-env";
import { HttpError, readJsonBody } from "@/lib/server/http";

function parseEnvironment(raw: string | null): ProjectEnvironment | null {
  if (!raw) return null;
  return validProjectEnvironment(raw) ? raw : null;
}

/** GET /api/projects/:id/env — variable names only (never values). */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  await connection();
  const a = await gate(req, { write: false, burstKey: "proj-env-list", perMinute: 60 });
  if (isResponse(a)) return a;
  const id = (await ctx.params).id;
  const p = await getProject(a.db, a.uid, id);
  if (!p) return json({ error: "Not found. / ไม่พบโปรเจกต์", code: "not_found" }, 404);
  const url = new URL(req.url);
  const envFilter = parseEnvironment(url.searchParams.get("environment"));
  if (url.searchParams.has("environment") && !envFilter) {
    return json({ error: "environment must be preview or production", code: "invalid" }, 400);
  }
  const variables = await listProjectEnv(a.db, a.uid, id, envFilter ?? undefined);
  return json(
    {
      variables,
      note: {
        en: "Secrets apply on the next build (install/build env) and on the next SSR Worker deploy (runtime bindings). Redeploy after changes.",
        th: "ค่าลับมีผลเมื่อ build ครั้งถัดไป (ตอน install/build) และเมื่อ deploy Worker SSR ครั้งถัดไป — เปลี่ยนแล้วควร redeploy",
      },
    },
    200,
    { "Cache-Control": "no-store" },
  );
}

/** POST /api/projects/:id/env { key, value, environment? } — value is write-only. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  await connection();
  const a = await gate(req, { write: true, burstKey: "proj-env-set", perMinute: 30 });
  if (isResponse(a)) return a;
  const id = (await ctx.params).id;
  const p = await getProject(a.db, a.uid, id);
  if (!p) return json({ error: "Not found. / ไม่พบโปรเจกต์", code: "not_found" }, 404);
  let body: Record<string, unknown>;
  try {
    body = ((await readJsonBody(req, 8_000)) ?? {}) as Record<string, unknown>;
  } catch (err) {
    return json({ error: err instanceof HttpError ? err.message : "Bad request", code: "invalid" }, err instanceof HttpError ? err.status : 400);
  }
  const key = typeof body.key === "string" ? body.key.trim().toUpperCase() : "";
  const value = typeof body.value === "string" ? body.value : "";
  const environment: ProjectEnvironment = validProjectEnvironment(body.environment) ? body.environment : "production";
  if (!validProjectEnvName(key)) {
    return json(
      {
        error: "Key must match [A-Z][A-Z0-9_]{1,63} and cannot be a reserved Worker name (DEVSTACK_PROXY_KEY, ASSETS, AI).",
        code: "invalid",
      },
      400,
    );
  }
  if (!value || value.length > 4_000) return json({ error: "Value required (max 4000 chars).", code: "invalid" }, 400);
  try {
    await saveProjectEnv(a.db, a.keys, a.uid, id, environment, key, value);
    return json({ ok: true, key, environment }, 200);
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === "too_many") return json({ error: "Limit 32 variables per environment.", code: "limit" }, 409);
    return json({ error: "Could not save.", code: "error" }, 500);
  }
}