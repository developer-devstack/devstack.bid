import "server-only";
import { z } from "zod";

const bool = (fallback: "true" | "false") => z.enum(["true", "false"]).catch(fallback).default(fallback);
const intIn = (min: number, max: number, fallback: number) =>
  z.string().trim().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(min).max(max)).catch(fallback).default(fallback);

const schema = z.object({
  /** Master switch — when false, custom-domain APIs and UI are hidden (ship dark until capacity verified). */
  CUSTOM_DOMAINS_ENABLED: bool("false"),
  /** Master switch for optional SSR Worker bindings (AI). */
  SERVER_BINDINGS_ENABLED: bool("false"),
  /** Platform-wide cap on `status = active` custom domains (pilot 100–200). */
  DEVSTACK_CUSTOM_DOMAINS_MAX_ACTIVE: intIn(0, 10_000, 200),
  /** Per-project cap (env replaces compile-time default). */
  DEVSTACK_CUSTOM_DOMAINS_PER_PROJECT: intIn(1, 50, 3),
  /** Distinct users that may hold ≥1 active custom domain (0 = unlimited). */
  DEVSTACK_CUSTOM_DOMAINS_MAX_USERS: intIn(0, 10_000, 200),
  /** D1 daily adds per user. */
  DEVSTACK_CUSTOM_DOMAINS_REGISTER_PER_USER_DAY: intIn(1, 100, 5),
  /** D1 daily verify attempts per user (each may call Cloudflare API). */
  DEVSTACK_CUSTOM_DOMAINS_VERIFY_PER_USER_DAY: intIn(1, 200, 20),
  /** In-memory fallback when NVX_DOMAINS_LIMITER binding is absent. */
  DOMAINS_BURST_PER_MIN: intIn(1, 120, 8),
});

export type HostingEnv = z.infer<typeof schema>;
const KEYS = Object.keys(schema.shape) as (keyof HostingEnv)[];

let cached: { env: HostingEnv; sig: string } | null = null;

export function hostingEnv(source: Record<string, string | undefined> = process.env): HostingEnv {
  const sig = KEYS.map((k) => source[k] ?? "").join("\u0000");
  if (cached && cached.sig === sig) return cached.env;
  const env = schema.parse(source);
  cached = { env, sig };
  return env;
}

export function customDomainsFeatureOn(source?: Record<string, string | undefined>): boolean {
  return hostingEnv(source).CUSTOM_DOMAINS_ENABLED === "true";
}

export function serverBindingsFeatureOn(source?: Record<string, string | undefined>): boolean {
  return hostingEnv(source).SERVER_BINDINGS_ENABLED === "true";
}

export async function readWorkerHostingEnv(): Promise<HostingEnv> {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const cf = await getCloudflareContext({ async: true });
    return hostingEnv(cf.env as unknown as Record<string, string | undefined>);
  } catch {
    return hostingEnv();
  }
}
