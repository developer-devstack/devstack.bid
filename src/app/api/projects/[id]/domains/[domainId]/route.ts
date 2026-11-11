import { connection } from "next/server";
import { json } from "@/lib/chat/runtime";
import { getProject } from "@/lib/connections/projects";
import { gate, isResponse } from "@/lib/connections/route-kit";
import { routeBuildBindings } from "@/lib/build/bindings";
import { removeProjectCustomDomain } from "@/lib/hosting/custom-domains";

/** DELETE /api/projects/:id/domains/:domainId */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string; domainId: string }> }) {
  await connection();
  const a = await gate(req, { write: true, burstKey: "proj-domains-del", perMinute: 10 });
  if (isResponse(a)) return a;
  const { id, domainId } = await ctx.params;
  const p = await getProject(a.db, a.uid, id);
  if (!p) return json({ error: "Not found. / ไม่พบโปรเจกต์", code: "not_found" }, 404);
  const builds = await routeBuildBindings();
  if (!builds.sites) return json({ error: "Hosting storage unavailable. / ที่เก็บเว็บไม่พร้อม", code: "no_sites" }, 503);
  try {
    await removeProjectCustomDomain(a.db, builds.sites, builds.cfApi ?? null, a.uid, domainId);
    return json({ ok: true }, 200);
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    if (msg === "not_found") return json({ error: "Not found. / ไม่พบ", code: "not_found" }, 404);
    return json({ error: "Could not remove domain. / ลบโดเมนไม่สำเร็จ", code: "error" }, 500);
  }
}
