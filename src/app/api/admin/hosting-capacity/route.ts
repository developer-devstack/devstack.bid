import { connection } from "next/server";
import { json } from "@/lib/chat/runtime";
import { gate, isResponse } from "@/lib/connections/route-kit";
import { identityOf, tierFor } from "@/lib/limits/tiers";
import { isAdmin } from "@/lib/aisite/admin";
import { hostingEnv } from "@/lib/hosting/config";
import { hostingCapabilities } from "@/lib/hosting/feature-gate";
import { countActiveCustomDomainUsers, countActiveCustomDomains } from "@/lib/hosting/domain-policy";

/** GET /api/admin/hosting-capacity — owner snapshot for 100–200 domain pilot (no PII). */
export async function GET(req: Request) {
  await connection();
  const a = await gate(req, { write: false, burstKey: "admin-host-cap", perMinute: 30 });
  if (isResponse(a)) return a;
  const owner = isAdmin(a.login) || tierFor(await identityOf(a.db, a.uid)) === "admin";
  if (!owner) return json({ error: "Owner only. / เฉพาะเจ้าของระบบ", code: "forbidden" }, 403);
  const h = hostingEnv();
  const [active, users, pending, error] = await Promise.all([
    countActiveCustomDomains(a.db),
    countActiveCustomDomainUsers(a.db),
    a.db.prepare("SELECT COUNT(*) AS n FROM project_custom_domains WHERE status = 'pending'").first<{ n: number }>(),
    a.db.prepare("SELECT COUNT(*) AS n FROM project_custom_domains WHERE status = 'error'").first<{ n: number }>(),
  ]);
  return json({
    ok: true,
    features: hostingCapabilities(),
    limits: {
      maxActiveDomains: h.DEVSTACK_CUSTOM_DOMAINS_MAX_ACTIVE,
      maxDomainUsers: h.DEVSTACK_CUSTOM_DOMAINS_MAX_USERS,
      perProject: h.DEVSTACK_CUSTOM_DOMAINS_PER_PROJECT,
      registerPerUserDay: h.DEVSTACK_CUSTOM_DOMAINS_REGISTER_PER_USER_DAY,
      verifyPerUserDay: h.DEVSTACK_CUSTOM_DOMAINS_VERIFY_PER_USER_DAY,
    },
    usage: {
      activeDomains: active,
      activeUsers: users,
      pendingDomains: pending?.n ?? 0,
      errorDomains: error?.n ?? 0,
    },
    headroom: {
      domains: Math.max(0, h.DEVSTACK_CUSTOM_DOMAINS_MAX_ACTIVE - active),
      users: h.DEVSTACK_CUSTOM_DOMAINS_MAX_USERS > 0 ? Math.max(0, h.DEVSTACK_CUSTOM_DOMAINS_MAX_USERS - users) : null,
    },
  });
}
