/**
 * devstack-sites: the user-site router for *.devstack.bid (separate Worker, never the platform).
 * Static → AWS S3. SSR → Workers for Platforms DISPATCHER binding (preferred) or legacy workers.dev proxy.
 * Holds no D1 access; its only secret is SITES_PROXY_SECRET (derives per-site proxy keys, never sent to the client).
 */
import { serveSite, unavailable, type DispatcherLike } from "../src/lib/hosting/serve";
import { proxyKey } from "../src/lib/hosting/server-worker";
import { createAwsS3Bucket, type AwsS3Env } from "../src/lib/storage/aws-s3";

type Env = AwsS3Env & {

  DISPATCHER?: DispatcherLike;
  PLATFORM_DOMAIN?: string;
  WORKERS_SUBDOMAIN?: string;
  SITES_PROXY_SECRET?: string;
};

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const domain = env.PLATFORM_DOMAIN || "devstack.bid";
    const u = new URL(req.url);
    // The *.devstack.bid route also captures www; send it to the platform apex.
    if (u.hostname === `www.${domain}`) {
      u.hostname = domain;
      return Response.redirect(u.toString(), 301);
    }
    try {
      const storage = createAwsS3Bucket(env);
      if (!storage) return unavailable(503);
      return await serveSite(req, storage, domain, {
        dispatcher: env.DISPATCHER,
        // Legacy fallback only when the dispatcher binding is absent.
        workersSubdomain: env.DISPATCHER ? undefined : env.WORKERS_SUBDOMAIN,
        proxyKeyFor: async (w) => (env.SITES_PROXY_SECRET ? proxyKey(env.SITES_PROXY_SECRET, w) : null),
      });
    } catch {
      return unavailable(503);
    }
  },
};
