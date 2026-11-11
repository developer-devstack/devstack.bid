import { connection } from "next/server";
import { json } from "@/lib/chat/runtime";
import { getProject } from "@/lib/connections/projects";
import { gate, isResponse } from "@/lib/connections/route-kit";
import { routeBuildBindings } from "@/lib/build/bindings";
import { CfApiError } from "@/lib/hosting/server-worker";
import { customDomainsFeatureOn, hostingEnv } from "@/lib/hosting/config";
import { consumeDomainVerifyQuota } from "@/lib/hosting/domain-policy";
import { domainsDisabledResponse } from "@/lib/hosting/feature-gate";
import { verifyProjectCustomDomain } from "@/lib/hosting/custom-domains";
import { clientIp } from "@/lib/server/http";
import { checkRateLimit } from "@/lib/server/rate-limit";

/** POST /api/projects/:id/domains/:domainId/verify — TXT check + Workers Custom Domain attach. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string; domainId: string }> }) {
  await connection();
  const a = await gate(req, { write: true, burstKey: "proj-domains-verify", perMinute: 10 });
  if (isResponse(a)) return a;
  if (!customDomainsFeatureOn()) return domainsDisabledResponse();
  const burst = await checkRateLimit("NVX_DOMAINS_LIMITER", `domains-verify:${clientIp(req)}`, hostingEnv().DOMAINS_BURST_PER_MIN, { memoryOnly: false });
  if (!burst.ok) return json({ error: "Too many requests. / ส่งคำขอถี่เกินไป", code: "rate_limited" }, 429, { "Retry-After": "60" });
  const { id, domainId } = await ctx.params;
  const p = await getProject(a.db, a.uid, id);
  if (!p) return json({ error: "Not found. / ไม่พบโปรเจกต์", code: "not_found" }, 404);
  const builds = await routeBuildBindings();
  if (!builds.sites) return json({ error: "Hosting storage unavailable. / ที่เก็บเว็บไม่พร้อม", code: "no_sites" }, 503);
  const quota = await consumeDomainVerifyQuota(a.db, a.uid);
  if (!quota.ok) {
    return json({ error: "Daily verify limit. / ครบโควต้ายืนยันโดเมนต่อวัน", code: "quota" }, 429, { "Retry-After": String(quota.retryAfterSec ?? 3600) });
  }
  try {
    const row = await verifyProjectCustomDomain(a.db, builds.sites, builds.cfApi ?? null, a.uid, domainId);
    return json(
      {
        domain: {
          id: row.id,
          hostname: row.hostname,
          status: row.status,
          verifiedAt: row.verified_at,
          url: `https://${row.hostname}`,
        },
      },
      200,
    );
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    if (msg === "not_found") return json({ error: "Not found. / ไม่พบ", code: "not_found" }, 404);
    if (msg === "verify_failed") {
      return json(
        {
          error: "TXT record not found yet. Add the challenge record and try again. / ยังไม่พบ TXT ให้เพิ่ม record แล้วลองใหม่",
          code: "verify_failed",
        },
        422,
      );
    }
    if (msg === "platform_domain_cap") {
      return json({ error: "Platform custom-domain capacity is full. / ครบจำนวนโดเมนทั้งแพลตฟอร์มแล้ว", code: "platform_domain_cap" }, 503);
    }
    if (msg === "platform_user_cap") {
      return json({ error: "Platform user cap for custom domains is full. / ครบจำนวนผู้ใช้ที่มีโดเมนแล้ว", code: "platform_user_cap" }, 503);
    }
    if (msg === "no_production_deployment") {
      return json(
        {
          error: "Deploy to production on DevStack first. / ต้อง deploy production บน DevStack ก่อน",
          code: "no_production_deployment",
        },
        422,
      );
    }
    if (msg === "cf_not_configured") {
      return json({ error: "Platform Cloudflare token not configured. / ยังไม่ตั้งค่า token ฝั่งแพลตฟอร์ม", code: "cf_not_configured" }, 503);
    }
    if (e instanceof CfApiError) {
      return json(
        {
          error: "Cloudflare rejected the domain (zone must be on the platform account). / Cloudflare ปฏิเสธโดเมน (โซนต้องอยู่ในบัญชีแพลตฟอร์ม)",
          code: "cf_api",
        },
        422,
      );
    }
    return json({ error: "Verification failed. / ยืนยันไม่สำเร็จ", code: "error" }, 500);
  }
}
