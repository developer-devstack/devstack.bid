# Server sites (Next.js / OpenNext) on `<slug>.devstack.bid`

Static builds are stored in R2 and served by `devstack-sites`. Apps that need a server
(Next.js with API routes, SSR, middleware) are uploaded as **user Workers into a single
Workers for Platforms dispatch namespace** (`SITES_DISPATCH_NAMESPACE`) — one namespace,
many scripts — not one standalone account Worker per project.

## Why WfP

- Account Workers-per-project hit Cloudflare limits and complicate routing.
- WfP dispatch namespaces are the supported multi-tenant model.
- `deployServerWorker` **requires** `dispatchNamespace` unless `allowLegacyWorkers: true`
  (tests / emergency only). Production hosting fails closed with `wfp_required` when the
  namespace env is unset.

## Flow

1. Build container (`container/build-server.mjs`) runs install + build. For Next.js the build
   command is `npx opennextjs-cloudflare build`, output `.open-next`.
2. If the output has `.open-next/worker.js` (and no `index.html`), the container runs
   `wrangler deploy --dry-run` to produce `worker/worker.js` + `assets/**` + `server.json`.
3. Platform (`src/lib/hosting/server-worker.ts`) wraps the module in the guard, then
   `PUT /accounts/:id/workers/dispatch/namespaces/:ns/scripts/:name` with assets upload.
4. `publishServer` writes `hosts/<label>.json` with `{ worker: "site-<hash>" }`.
5. `devstack-sites` routes SSR hosts via the `DISPATCHER` binding to namespace `devstack-sites`.

Script names remain `site-<hash(projectId)>` (production) and
`site-<hash(projectId)>-<hash(deploymentId)>` (preview).

## Env (platform Worker)

| Var | Role |
|---|---|
| `SITES_CF_ACCOUNT_ID` | Account id |
| `SITES_CF_API_TOKEN` | Token with dispatch-namespace script edit |
| `SITES_PROXY_SECRET` | HMAC for guard (≥32 chars) |
| `SITES_DISPATCH_NAMESPACE` | **Required** for SSR hosting uploads |

## GO required

Dispatch namespace `devstack-sites` + `DISPATCHER` binding on the serving Worker are provisioned
with owner GO (see `DEVSTACK-HOSTING.md`).
