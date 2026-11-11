import "server-only";
import type { D1Like } from "@/lib/chat/store";
import { consume, type LimitKind, windows } from "@/lib/chat/limits";
import { hostingEnv } from "./config";

export function maxDomainsPerProject(): number {
  return hostingEnv().DEVSTACK_CUSTOM_DOMAINS_PER_PROJECT;
}

export function maxActiveDomainsPlatform(): number {
  return hostingEnv().DEVSTACK_CUSTOM_DOMAINS_MAX_ACTIVE;
}

export async function countActiveCustomDomains(db: D1Like): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM project_custom_domains WHERE status = 'active'").first<{ n: number }>();
  return row?.n ?? 0;
}

export async function countActiveCustomDomainUsers(db: D1Like): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(DISTINCT user_id) AS n FROM project_custom_domains WHERE status = 'active'")
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function assertPlatformDomainCapacity(db: D1Like, uid?: string): Promise<void> {
  const h = hostingEnv();
  const active = await countActiveCustomDomains(db);
  if (active >= h.DEVSTACK_CUSTOM_DOMAINS_MAX_ACTIVE) throw new Error("platform_domain_cap");
  if (h.DEVSTACK_CUSTOM_DOMAINS_MAX_USERS > 0) {
    const already = uid
      ? await db.prepare("SELECT 1 AS x FROM project_custom_domains WHERE user_id = ?1 AND status = 'active' LIMIT 1").bind(uid).first<{ x: number }>()
      : null;
    if (!already) {
      const users = await countActiveCustomDomainUsers(db);
      if (users >= h.DEVSTACK_CUSTOM_DOMAINS_MAX_USERS) throw new Error("platform_user_cap");
    }
  }
}

function domainDayRules(uid: string, kind: "register" | "verify"): { scope: string; bucket: string; limit: number; kind: LimitKind }[] {
  const h = hostingEnv();
  const w = windows();
  const limit = kind === "register" ? h.DEVSTACK_CUSTOM_DOMAINS_REGISTER_PER_USER_DAY : h.DEVSTACK_CUSTOM_DOMAINS_VERIFY_PER_USER_DAY;
  const kindId: LimitKind = kind === "register" ? "domain_register_user_day" : "domain_verify_user_day";
  return [{ scope: `domain:${kind}:u:${uid}`, bucket: w.day, limit, kind: kindId }];
}

export async function consumeDomainRegisterQuota(db: D1Like, uid: string) {
  return consume(db, domainDayRules(uid, "register"));
}

export async function consumeDomainVerifyQuota(db: D1Like, uid: string) {
  return consume(db, domainDayRules(uid, "verify"));
}
