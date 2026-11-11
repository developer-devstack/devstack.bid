# Custom domains on DevStack hosting (beta)

Status: **implemented, ship-dark** — `CUSTOM_DOMAINS_ENABLED=false` and `SERVER_BINDINGS_ENABLED=false` in `wrangler.jsonc` until the 100–200 domain pilot is verified. Capacity plan: [../operations/CUSTOM-DOMAINS-CAPACITY-200.md](../operations/CUSTOM-DOMAINS-CAPACITY-200.md).

## Prerequisites

1. A **production** DevStack hosting deployment (`*.devstack.bid` live URL).
2. The custom hostname's **DNS zone on Cloudflare** in the platform account (Workers Custom Domain + edge certificate).
3. Platform secrets: `SITES_CF_API_TOKEN` (Workers Scripts: Edit), `SITES_CF_ACCOUNT_ID`, `SITES_DISPATCH_NAMESPACE`, `SITES_PROXY_SECRET`, R2 `SITES`.

## Flow

1. User adds `app.example.com` on the project page or `POST /api/projects/:id/domains`.
2. User creates TXT `_devstack-challenge.app.example.com` = verify token (shown in API/UI).
3. `POST /api/projects/:id/domains/:domainId/verify` checks TXT (public DNS), attaches Workers Custom Domain to **`devstack-sites`**, writes `custom-hosts/app.example.com.json` in R2 pointing at the current production deployment (and server Worker if SSR).
4. Promote / rollback / SSR production deploy calls `syncActiveCustomDomains` so all active domains track the new deployment.

## Limits

- Max **5** custom domains per project.
- Hostnames must not be under `*.devstack.bid` (use the free subdomain instead).
- Preview URLs remain `*.devstack.bid` only.

## Server bindings (SSR)

`PUT /api/projects/:id/server-bindings` with `{ "ai": true }` adds a Workers AI binding on the next OpenNext upload. No platform D1/R2 bindings. Redeploy production to apply.

## Cost

No extra DevStack SKU in this beta. User pays their domain registrar; Cloudflare zone/Workers usage stays on the **platform** account (owner-approved spend). Customer-specific Cloudflare deploy (`target=cloudflare`) is unchanged — attach custom domains in their own dashboard.
