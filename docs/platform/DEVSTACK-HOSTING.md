# DevStack first-party hosting (`*.devstack.bid`)

Status: **product path** (this PR). Deploy/Retry default to DevStack hosting.
User Cloudflare / Vercel remain **optional** targets for people who want their own account.

## Hard rule: no per-project GitHub activity on the hosting path

DevStack hosting **must never** create GitHub repositories, forks, pushes, branches, or
webhooks for a user project. Creating repos under load previously caused GitHub spam bans.

| Source of truth | Where |
|---|---|
| Project files / templates | D1 `project_files` + R2 `sources/<projectId>/latest.tar` |
| Build artifacts | R2 `artifacts/<jobId>.tar` + `sites/<deploymentId>/…` |
| SSR apps | Workers for Platforms **dispatch namespace** (one namespace, many scripts) |
| Static sites | R2 served by `devstack-sites` |

Import of an **existing** user GitHub repo (read-only clone with the user's OAuth) remains
an optional path. New projects / templates / chat `github_create_repo` / MCP `create_project`
create **hosted** projects only (`createHostedProject`) — zero GitHub write traffic.

### GitHub-activity audit (create / fork / push / branch / webhook)

Paths that **created** repos or wrote to GitHub, and how they relate to hosting:

| File:line (approx) | Activity | Hosting default |
|---|---|---|
| `src/lib/auth/github-api.ts:234` `createRepo` | Create repository | API kept for tests only; **not** called from hosting |
| `src/lib/connections/github-service.ts:48` `createProjectRepo` | Was: create repo + seed | **Disabled** — throws `forbidden` (403), no GitHub call |
| `src/lib/connections/github-service.ts:68` `createHostedProject` | D1 + R2 sources | **Default** create / template path |
| `src/app/api/projects/route.ts` POST | Was: `createProjectRepo` | Now: `createHostedProject` |
| `src/lib/chat/customer-tools.ts:91` `github_create_repo` | Was: create repo | Now: `createHostedProject` |
| `src/lib/mcp/platform-tools.ts` `create_project` | Was: create repo | Now: `createHostedProject` (no GitHub token) |
| `src/lib/connections/github-service.ts:110`/`127` `proposeChanges` / `commitToBranch` | Branch + commit + PR | **Opt-in** on existing imported repos only (prepare / chat); never for hosted projects |
| `src/lib/aisite/repo-turn.ts` `syncAiBranch` + `ai-turn` `commitFiles` | Branch + push | Requires `repo_full_name`; hosted projects have none |
| `src/lib/chat/customer-tools.ts` `github_create_branch` / commit tools | Branch / push | Existing-repo tools only |
| `src/lib/github/autodeploy.ts` + webhook routes | Push → build | Only for imported repos with webhooks; not created by hosting |
| `src/app/api/projects/import/route.ts` | Import existing repo | Read-only register + optional container clone; **does not create** a repo |
| `src/lib/hosting/deploy.ts` Deploy / Retry | Hosting entry | Archive build (R2) or clone **existing** repo; never createRepo |
| Fork APIs | — | **None** in tree |

## Goal

A signed-in user can create a hosted project (template / chat / MCP), upload sources, or
optionally import an existing GitHub repo, and get a live URL on DevStack —
`<slug>.devstack.bid` (production) and `<slug>-<shortid>.devstack.bid` (preview) —
**without** connecting Cloudflare at `/settings/connections`.

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
   │ Hosted R2 sources?  │                  → customer CF token
   │  → archive container│                  → *.workers.dev
   │ Imported GitHub?    │
   │  → clone (OAuth)    │
   │ Static zip ready?   │
   │  → R2 publish       │
   └──────────┬──────────┘
              ▼
   R2 `devstack-sites`
     sources/<projectId>/latest.tar
     sites/<deploymentId>/…
     hosts/<label>.json   { projectId, deploymentId, worker? }
              │
              ▼
   Worker `devstack-sites`  (route *.devstack.bid)
     static → R2 object
     server → WfP dispatcher → user Worker script in SITES_DISPATCH_NAMESPACE
              (legacy workers.dev proxy only if allowLegacyWorkers — not default)
```

### Build pipeline

1. `startContainerBuild` creates `build_jobs` (`executor=cf-container`) + `deployments`
   (`target=devstack-sites`) and enqueues `BUILD_QUEUE`.
2. **Archive mode** (hosted): executor reads `sources/<id>/latest.tar` from R2, POSTs it to
   container `/source`, then `/build` with `source: "archive"` — **no git, no token**.
3. **GitHub mode** (imported existing repo only): container clones with the user's OAuth
   token (http.extraheader; scrubbed before install/build). Public repos may omit the token.
4. Package manager from lockfile; install env forces public npm registry.
5. Static output → tar → R2 sites; OpenNext → `deployServerWorker` into the WfP dispatch
   namespace (`SITES_DISPATCH_NAMESPACE` required) + `publishServer`.
6. Logs stream into `build_events` + R2 (secrets redacted).

### Zip / static upload

`publishUploadedSite` for ready static files. Profiles with `path=cf-build` go through
archive container via `startHostingDeploy` (sources uploaded to R2 first).

## Subdomains, rollback, records

| Item | Behaviour |
|---|---|
| Production host | `<slug>.devstack.bid` — first project to claim a host owns it |
| Preview host | `<slug>-<shortid>.devstack.bid` — immutable per deployment |
| Rollback | `POST …/rollback` points production at a previous **live** deployment |
| Reserved labels | `RESERVED` / `RESERVED_SUBSTRINGS` in `hostnames.ts` |
| Abuse badge | HTML footer → report form → `site_reports` |

## Abuse safeguards

- Caps: concurrent container builds, per-user daily/hourly builds, deploy quota.
- Size: `MAX_SITE_FILES` / `MAX_SITE_BYTES`; zip/file limits in `upload.ts`.
- Secrets: never logged; sanitizeLog; zip secret scanners; no secrets in chat.
- Egress allowlist on the build container; no platform D1/R2 bindings in customer Workers.
- **No GitHub create/push from hosting** (this document's hard rule).
- Takedown: site report + host ownership; preview Worker cleanup cron.
- Blocklist: reserved DNS labels; platform denylist for server Worker names.

## What this PR does **not** do (needs owner GO)

Exact production steps that must wait for explicit GO:

1. Merge PR to `main` / prod deploy of `nvx-stack-builder`
2. Remote D1 migrations (if any new ones are added later)
3. Create Workers for Platforms **dispatch namespace** (suggested name: `devstack-sites`) and set secret `SITES_DISPATCH_NAMESPACE`
4. Bind a **dispatcher Worker** (or extend `devstack-sites`) with `dispatch_namespaces` → that namespace; route `*.devstack.bid` SSR via it
5. Ensure `SITES_CF_API_TOKEN` has Scripts:Edit on the dispatch namespace (not only account Workers)
6. New R2 buckets only if not reusing `devstack-sites` for `sources/` prefix (default: reuse)
7. Queues / Containers image push / DNS wildcard / other `SITES_*` secret changes beyond the namespace
8. Enabling Workers for Platforms purchase on the Cloudflare account if still disabled (was API 10121)

## API surface

| Method | Path | Default |
|---|---|---|
| POST | `/api/projects` | Create **hosted** project (no GitHub repo) |
| POST | `/api/projects/:id/deploy` | `target=devstack` → hosting; `target=cloudflare` optional |
| POST | `/api/projects/:id/builds` | container build (archive or imported repo) |
| POST | `/api/projects/:id/rollback` | promote a prior live deployment to production |
| POST | `/api/deployments/:id/rollback` | same, keyed by deployment id |
