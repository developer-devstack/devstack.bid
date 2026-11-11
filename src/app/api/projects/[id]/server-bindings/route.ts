import { connection } from "next/server";
import { json } from "@/lib/chat/runtime";
import { getProject } from "@/lib/connections/projects";
import { gate, isResponse } from "@/lib/connections/route-kit";
import { getProjectServerBindings, parseServerBindings, setProjectServerBindings } from "@/lib/hosting/server-bindings";

/** GET /api/projects/:id/server-bindings */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  await connection();
  const a = await gate(req, { write: false, burstKey: "proj-bindings", perMinute: 60 });
  if (isResponse(a)) return a;
  const id = (await ctx.params).id;
  const p = await getProject(a.db, a.uid, id);
  if (!p) return json({ error: "Not found. / ไม่พบโปรเจกต์", code: "not_found" }, 404);
  const bindings = await getProjectServerBindings(a.db, id, a.uid);
  return json({ bindings, note: { en: "Changes apply on the next SSR (OpenNext) production deploy.", th: "การเปลี่ยนแปลงมีผลเมื่อ deploy production ครั้งถัดไป (OpenNext)" } }, 200, { "Cache-Control": "no-store" });
}

/** PUT /api/projects/:id/server-bindings { ai?: boolean } */
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  await connection();
  const a = await gate(req, { write: true, burstKey: "proj-bindings-set", perMinute: 10 });
  if (isResponse(a)) return a;
  const id = (await ctx.params).id;
  const p = await getProject(a.db, a.uid, id);
  if (!p) return json({ error: "Not found. / ไม่พบโปรเจกต์", code: "not_found" }, 404);
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON. / JSON ไม่ถูกต้อง", code: "invalid" }, 400);
  }
  const spec = parseServerBindings(JSON.stringify(body));
  const saved = await setProjectServerBindings(a.db, id, a.uid, spec);
  return json({ bindings: saved }, 200);
}
