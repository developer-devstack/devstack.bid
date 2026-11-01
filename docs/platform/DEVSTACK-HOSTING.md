# DevStack first-party hosting (`*.devstack.bid`)

Status: **product path** (this PR). Deploy/Retry default to DevStack hosting.
User Cloudflare / Vercel remain **optional** targets for people who want their own account.

## Goal

A signed-in user can import a GitHub repo (their OAuth) or upload a zip and get a live
URL on DevStack's own platform — `<slug>.devstack.bid` (production) and
`<slug>-<shortid>.devstack.bid` (preview) — **without** connecting Cloudflare at
`/settings/connections`.

Nothing in this path uses the platform owner's GitHub account or GitHub App to clone
customer code. Clone tokens come only from the customer's own GitHub OAuth (or the
build runs on an uploaded zip with no git).

## Architecture

```
                 ┌──────────────────────────────────────────────┐
  UI / chat      │  POST /api/projects/:id/deploy                │
  Retry deploy ──┤    target=devstack (default) | cloudflare    │
  Redeploy       └──────────────┬───────────────────────────────┘
                                │
              ┌─────────────────┴──────────────────┐
              ▼                                    ▼
   target=devstack                          target=cloudflare
   (first-party)                            (optional)
              │                                    │
   ┌──────────┴──────────┐                  startDeploy()
   │ GitHub repo?        │                  → customer CF token
   │ yes → container     │                  → *.workers.dev
   │ build (Queue +      │
   │ Containers)         │
   │ no  → static zip    │
   │ publish to R2       │
   └──────────┬──────────┘
              ▼
   R2 `devstack-sites`
     sites/<deploymentId>/…
     hosts/<label>.json   { projectId, deploymentId, worker? }
              │
              ▼
   Worker `devstack-sites`  (route *.devstack.bid)
     static → R2 object
     server → proxy to site-<hash>.workers.dev (guard + HMAC)
```

### Build pipeline (GitHub)

1. `startContainerBuild` creates `build_jobs` (`executor=cf-container`) + `deployments`
   (`target=devstack-sites`) and enqueues `BUILD_QUEUE`.
2. Container clones **with the user's OAuth token** (http.extraheader only; scrubbed
   before install/build). Public repos may omit the token.
3. Package manager from lockfile: bun → pnpm → yarn → `npm ci` → `npm install`.
4. Install env forces `npm_config_registry=https://registry.npmjs.org/` so a leftover
   private `.npmrc` cannot 403 the public registry. Same for yarn/pnpm registry URLs.
5. Framework detect / OpenNext prepare for Next.js; static output → tar → R2 sites;
   OpenNext → `deployServerWorker` + `publishServer`.
6. Logs stream into `build_events` + R2 (secrets redacted). Statuses:
   `queued → claimed → installing → building → uploading → succeeded|failed|…`.

### Zip / static upload (no GitHub)

`publishUploadedSite` reads `project_files`, writes `sites/<id>/…`, aliases preview
(and production when requested). Profiles that need a build (`needs_build`) are
rejected with a clear error — those must go through GitHub + container.

### Optional user Cloudflare

`target=cloudflare` keeps the existing direct-upload path into the customer's
Workers account (connection or one-shot token). Chat Retry and primary Deploy
buttons do **not** use this path unless the user explicitly chooses it.

## Subdomains, rollback, records

| Item | Behaviour |
|---|---|
| Production host | `<slug>.devstack.bid` — first project to claim a host owns it |
| Preview host | `<slug>-<shortid>.devstack.bid` — immutable per deployment |
| Rollback | `POST …/rollback` points production at a previous **live** deployment of the same project via `promoteProduction` |
| Reserved labels | `RESERVED` / `RESERVED_SUBSTRINGS` in `hostnames.ts` |
| Abuse badge | HTML footer → report form → `site_reports` |

## Abuse safeguards (already in tree; this PR wires defaults)

- Caps: concurrent container builds, per-user daily/hourly builds, deploy quota.
- Size: `MAX_SITE_FILES` / `MAX_SITE_BYTES`; zip/file limits in `upload.ts`.
- Secrets: never logged; sanitizeLog; zip secret scanners; no secrets in chat.
- Egress allowlist on the build container; no platform D1/R2 bindings in customer Workers.
- Takedown: site report + host ownership; preview Worker cleanup cron.
- Blocklist: reserved DNS labels; platform denylist for server Worker names.

## What this PR does **not** do (needs owner GO)

- Merge to `main` / prod deploy of `nvx-stack-builder`
- Remote D1 migrations
- Creating production resources (new R2 buckets, Queues, Containers image push,
  Workers for Platforms dispatch namespace)
- DNS / secret changes (`SITES_*`, wildcard route)
- Enabling Workers for Platforms (preferred later for SSR tenant isolation;
  today server apps use per-project Workers + proxy)

## API surface

| Method | Path | Default |
|---|---|---|
| POST | `/api/projects/:id/deploy` | `target=devstack` → hosting; `target=cloudflare` optional |
| POST | `/api/projects/:id/builds` | container build (unchanged) |
| POST | `/api/projects/:id/rollback` | promote a prior live deployment to production |
| POST | `/api/deployments/:id/rollback` | same, keyed by deployment id |

