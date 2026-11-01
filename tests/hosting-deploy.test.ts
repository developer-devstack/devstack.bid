import { describe, expect, it, beforeAll } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { publishUploadedSite, rollbackHostingDeployment } from "@/lib/hosting/deploy";
import { serveSite, type R2BucketLike } from "@/lib/hosting/serve";
import { sqliteD1 } from "./helpers/sqlite-d1";
import { saveProjectFiles } from "@/lib/deploy/upload";
import type { ProjectRow } from "@/lib/connections/projects";

function memBucket(): R2BucketLike & { keys: () => string[]; getJson: (k: string) => Promise<unknown> } {
  const m = new Map<string, { bytes: Uint8Array; type?: string }>();
  return {
    keys: () => [...m.keys()],
    async getJson(key) {
      const v = m.get(key);
      return v ? JSON.parse(new TextDecoder().decode(v.bytes)) : null;
    },
    async get(key) {
      const v = m.get(key);
      if (!v) return null;
      return { body: new Response(v.bytes as BlobPart).body!, httpEtag: `"${key}"`, httpMetadata: { contentType: v.type }, text: async () => new TextDecoder().decode(v.bytes) };
    },
    async put(key, value, opts) {
      const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value instanceof Uint8Array ? value : new Uint8Array(value as ArrayBuffer);
      m.set(key, { bytes, type: opts?.httpMetadata?.contentType });
    },
  };
}

const enc = (s: string) => new TextEncoder().encode(s);

function project(over: Partial<ProjectRow> = {}): ProjectRow {
  return {
    id: "proj-host-0001",
    user_id: "userA",
    name: "demo-site",
    template_id: null,
    repo_full_name: null,
    default_branch: null,
    created_at: Date.now(),
    slug: "demo-site",
    source: "upload",
    provider: "devstack-sites",
    ...over,
  };
}

async function seedUpload(files: { path: string; content: string }[]) {
  const db = sqliteD1();
  db.raw.exec("INSERT INTO users (id) VALUES ('userA'); INSERT INTO projects (id, user_id, name, slug, source, provider) VALUES ('proj-host-0001', 'userA', 'demo-site', 'demo-site', 'upload', 'devstack-sites')");
  await saveProjectFiles(db, "proj-host-0001", files.map((f) => ({ path: f.path, bytes: enc(f.content) })));
  return db;
}

describe("DevStack first-party hosting deploy", () => {
  it("publishes an uploaded static zip to *.devstack.bid without Cloudflare credentials", async () => {
    const db = await seedUpload([
      { path: "index.html", content: "<h1>hello-hosting</h1>" },
      { path: "about.html", content: "about" },
    ]);
    const sites = memBucket();
    const r = await publishUploadedSite(db, sites, true, "userA", project(), "preview");
    expect(r.kind).toBe("devstack-static");
    expect(r.deployment.status).toBe("live");
    expect(r.deployment.target).toBe("devstack-sites");
    expect(r.previewUrl).toMatch(/^https:\/\/demo-site-[a-z0-9]{6}\.devstack\.bid$/);
    const page = await serveSite(new Request(`${r.previewUrl}/`), sites);
    expect(page.status).toBe(200);
    expect(await page.text()).toMatch(/hello-hosting/);
    const dep = await db.prepare("SELECT status, target, url FROM deployments WHERE id = ?1").bind(r.deployment.id).first<{ status: string; target: string; url: string }>();
    expect(dep).toMatchObject({ status: "live", target: "devstack-sites", url: r.previewUrl });
  });

  it("rejects uploads that still need a build step (point user at GitHub Deploy)", async () => {
    const db = await seedUpload([
      { path: "package.json", content: JSON.stringify({ name: "app", scripts: { build: "vite build" }, dependencies: { react: "19.0.0" } }) },
      { path: "src/main.tsx", content: "export {}" },
    ]);
    const sites = memBucket();
    await expect(publishUploadedSite(db, sites, true, "userA", project())).rejects.toMatchObject({ code: "invalid", status: 422 });
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM deployments").get()).toEqual({ n: 0 });
  });

  it("rollbacks production hostname to a previous live deployment", async () => {
    const db = await seedUpload([
      { path: "index.html", content: "<h1>v1</h1>" },
    ]);
    const sites = memBucket();
    const v1 = await publishUploadedSite(db, sites, true, "userA", project(), "production");
    expect(v1.deployment.status).toBe("live");
    // Second publish as preview, then promote via rollback of v1 (already production) — publish a new live and roll back.
    await saveProjectFiles(db, "proj-host-0001", [{ path: "index.html", bytes: enc("<h1>v2</h1>") }]);
    const v2 = await publishUploadedSite(db, sites, true, "userA", project(), "production");
    expect(await (await serveSite(new Request("https://demo-site.devstack.bid/"), sites)).text()).toMatch(/v2/);
    const rb = await rollbackHostingDeployment(db, sites, "userA", v1.deployment.id);
    expect(rb.url).toBe("https://demo-site.devstack.bid");
    expect(await (await serveSite(new Request(rb.url + "/"), sites)).text()).toMatch(/v1/);
    const prod = await db.prepare("SELECT id, environment, alias_url FROM deployments WHERE alias_url IS NOT NULL").bind().first<{ id: string; environment: string }>();
    expect(prod).toMatchObject({ id: v1.deployment.id, environment: "production" });
  });

  it("refuses rollback for non-live or non-devstack deployments", async () => {
    const db = sqliteD1();
    db.raw.exec("INSERT INTO users (id) VALUES ('userA'); INSERT INTO projects (id, user_id, name, slug) VALUES ('proj-host-0001', 'userA', 'demo-site', 'demo-site')");
    db.raw.exec("INSERT INTO deployments (id, project_id, user_id, ref, target, status) VALUES ('dep-cf-00000001', 'proj-host-0001', 'userA', 'main', 'cf-workers', 'live')");
    db.raw.exec("INSERT INTO deployments (id, project_id, user_id, ref, target, status) VALUES ('dep-fail-000001', 'proj-host-0001', 'userA', 'main', 'devstack-sites', 'failed')");
    const sites = memBucket();
    await expect(rollbackHostingDeployment(db, sites, "userA", "dep-cf-00000001")).rejects.toMatchObject({ code: "invalid" });
    await expect(rollbackHostingDeployment(db, sites, "userA", "dep-fail-000001")).rejects.toMatchObject({ code: "invalid" });
  });
});

describe("build container public registry pin", () => {
  let pinPublicRegistry: (dir: string, emit?: (e: unknown) => void) => void;
  beforeAll(async () => {
    process.env.BUILD_SERVER_NO_LISTEN = "1";
    ({ pinPublicRegistry } = await import("../container/build-server.mjs"));
  });

  it("rewrites private registry entries in .npmrc to registry.npmjs.org", () => {
    const dir = mkdtempSync(join(tmpdir(), "npmrc-"));
    writeFileSync(join(dir, ".npmrc"), "registry=https://npm.pkg.github.com/\n//npm.pkg.github.com/:_authToken=SECRET\n");
    const logs: string[] = [];
    pinPublicRegistry(dir, (e: unknown) => { if ((e as { chunk?: string }).chunk) logs.push((e as { chunk: string }).chunk); });
    const after = readFileSync(join(dir, ".npmrc"), "utf8");
    expect(after).toContain("registry=https://registry.npmjs.org/");
    expect(after).toMatch(/^registry=https:\/\/registry\.npmjs\.org\//m);
    expect(after).toContain("_authToken=SECRET"); // auth line left; install uses public registry via env
    expect(logs.join("")).toMatch(/Pinned \.npmrc/);
  });
});
