import { connection } from "next/server";
import { json } from "@/lib/chat/runtime";
import { getProject } from "@/lib/connections/projects";
import { gate, isResponse } from "@/lib/connections/route-kit";
import {
  addProjectCustomDomain,
  challengeRecordName,
  listProjectCustomDomains,
  VERIFY_LABEL,
} from "@/lib/hosting/custom-domains";

/** GET /api/projects/:id/domains — custom domains for this project. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  await connection();
  const a = await gate(req, { write: false, burstKey: "proj-domains", perMinute: 60 });
  if (isResponse(a)) return a;
  const id = (await ctx.params).id;
  const p = await getProject(a.db, a.uid, id);
  if (!p) return json({ error: "Not found. / ไม่พบโปรเจกต์", code: "not_found" }, 404);
  const domains = await listProjectCustomDomains(a.db, id, a.uid);
  const items = domains.map((d) => ({
    id: d.id,
    hostname: d.hostname,
    status: d.status,
    createdAt: d.created_at,
    verifiedAt: d.verified_at,
    errorMessage: d.error_message,
    challenge: { type: "TXT", name: challengeRecordName(d.hostname), value: d.verify_token },
  }));
  return json({ domains: items, verifyLabel: VERIFY_LABEL }, 200, { "Cache-Control": "no-store" });
}

/** POST /api/projects/:id/domains { hostname } — register a pending custom domain. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  await connection();
  const a = await gate(req, { write: true, burstKey: "proj-domains-add", perMinute: 10 });
  if (isResponse(a)) return a;
  const id = (await ctx.params).id;
  const p = await getProject(a.db, a.uid, id);
  if (!p) return json({ error: "Not found. / ไม่พบโปรเจกต์", code: "not_found" }, 404);
  let body: { hostname?: string };
  try {
    body = (await req.json()) as { hostname?: string };
  } catch {
    return json({ error: "Invalid JSON. / JSON ไม่ถูกต้อง", code: "invalid" }, 400);
  }
  const hostname = String(body.hostname ?? "").trim();
  if (!hostname) return json({ error: "hostname is required. / ต้องระบุ hostname", code: "invalid" }, 400);
  try {
    const row = await addProjectCustomDomain(a.db, a.uid, id, hostname);
    return json(
      {
        domain: {
          id: row.id,
          hostname: row.hostname,
          status: row.status,
          challenge: { type: "TXT", name: challengeRecordName(row.hostname), value: row.verify_token },
          cfNote: {
            en: "The hostname zone must be on the same Cloudflare account as DevStack hosting. After TXT verification we attach a Workers Custom Domain to devstack-sites.",
            th: "โซน DNS ของโดเมนต้องอยู่ในบัญชี Cloudflare เดียวกับโฮสต์ DevStack หลังยืนยัน TXT แล้วระบบจะผูก Workers Custom Domain กับ devstack-sites",
          },
        },
      },
      201,
    );
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    if (msg === "invalid_hostname") return json({ error: "Invalid hostname. / ชื่อโดเมนไม่ถูกต้อง", code: "invalid_hostname" }, 422);
    if (msg === "hostname_taken") return json({ error: "Hostname already in use. / โดเมนนี้ถูกใช้แล้ว", code: "hostname_taken" }, 409);
    if (msg === "domain_limit") return json({ error: "Custom domain limit reached. / ครบจำนวนโดเมนที่อนุญาตแล้ว", code: "domain_limit" }, 422);
    return json({ error: "Could not add domain. / เพิ่มโดเมนไม่สำเร็จ", code: "error" }, 500);
  }
}
