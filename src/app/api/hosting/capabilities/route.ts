import { connection } from "next/server";
import { json } from "@/lib/chat/runtime";
import { hostingEnv } from "@/lib/hosting/config";
import { hostingCapabilities } from "@/lib/hosting/feature-gate";

/** GET /api/hosting/capabilities — feature flags for UI (no secrets). */
export async function GET() {
  await connection();
  const h = hostingEnv();
  return json(
    {
      ...hostingCapabilities(),
      limits: {
        maxActiveDomains: h.DEVSTACK_CUSTOM_DOMAINS_MAX_ACTIVE,
        maxDomainUsers: h.DEVSTACK_CUSTOM_DOMAINS_MAX_USERS,
        perProject: h.DEVSTACK_CUSTOM_DOMAINS_PER_PROJECT,
      },
    },
    200,
    { "Cache-Control": "public, max-age=60" },
  );
}
