import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let mod: {
  prepareOpenNext(d: string, b: string | undefined): string[];
  openNextInstallCmd(d: string, pm: string | null): string | null;
  nextSatisfiesOpenNext(raw: string): boolean;
  targetNextForOpenNext(raw: string): string;
  ensureNextForOpenNext(d: string, pm: string | null): { from: string; to: string; bumped: { name: string; from: string; to: string }[]; installCmd: string } | null;
  sanitizeVercelOtel(d: string, emit?: (m: { t: string; phase: string; chunk: string }) => void): { notes: string[] } | null;
  isEresolveLog(log: string): boolean;
  withLegacyPeerDeps(install: string): string | null;
  OPENNEXT_NEXT_MIN_15: string;
  OPENNEXT_NEXT_MIN_16: string;
  VERCEL_OTEL_MIN: string;
  BUILD_CMD_TIMEOUT_MS: number;
  INSTALL_CMD_TIMEOUT_MS: number;
  BUILD_STALL_MS: number;
  killProcessTree(child: { pid?: number; kill?: (s?: string) => void } | null, sig?: string): void;
  fixRecursiveOpenNextBuildScript(d: string, emit?: (m: { t: string; phase: string; chunk: string }) => void): { from: string; to: string } | null;
};
beforeAll(async () => { process.env.BUILD_SERVER_NO_LISTEN = "1"; mod = await import("../container/build-server.mjs"); });

const repo = (pkg: object, files: Record<string, string> = {}) => {
  const d = mkdtempSync(join(tmpdir(), "onx-"));
  writeFileSync(join(d, "package.json"), JSON.stringify(pkg));
  for (const [f, c] of Object.entries(files)) writeFileSync(join(d, f), c);
  return d;
};
const CMD = "npx opennextjs-cloudflare build";

describe("auto Cloudflare config for plain Next.js repos", () => {
  it("adds open-next.config.ts and wrangler.jsonc to a create-next-app repo", () => {
    const d = repo({ name: "My App", dependencies: { next: "15.5.30" } });
    expect(mod.prepareOpenNext(d, CMD)).toEqual(["open-next.config.ts", "wrangler.jsonc"]);
    expect(readFileSync(join(d, "open-next.config.ts"), "utf8")).toContain("defineCloudflareConfig");
    const w = JSON.parse(readFileSync(join(d, "wrangler.jsonc"), "utf8"));
    expect(w).toMatchObject({ name: "my-app", main: ".open-next/worker.js", assets: { directory: ".open-next/assets" } });
    expect(w.compatibility_flags).toContain("nodejs_compat");
  });
  it("never overwrites the repo's own config", () => {
    const d = repo({ dependencies: { next: "16.4.1" } }, { "open-next.config.ts": "MINE", "wrangler.toml": "name='x'" });
    expect(mod.prepareOpenNext(d, CMD)).toEqual([]);
    expect(readFileSync(join(d, "open-next.config.ts"), "utf8")).toBe("MINE");
    expect(existsSync(join(d, "wrangler.jsonc"))).toBe(false);
  });
  it("does nothing for non-OpenNext builds or non-Next repos", () => {
    expect(mod.prepareOpenNext(repo({ dependencies: { next: "15.5.30" } }), "npm run build")).toEqual([]);
    expect(mod.prepareOpenNext(repo({ dependencies: { vite: "7" } }), CMD)).toEqual([]);
  });
  it("installs the adapter only when it's missing, with the repo's package manager and a shell-safe command", () => {
    const d = repo({ dependencies: { next: "15.5.30" } });
    expect(mod.openNextInstallCmd(d, "npm")).toBe("npm install --no-save @opennextjs/cloudflare@1");
    expect(mod.openNextInstallCmd(d, "pnpm")).toBe("pnpm add -D @opennextjs/cloudflare@1");
    for (const pm of ["npm", "pnpm", "yarn", "bun", null]) expect(mod.openNextInstallCmd(d, pm)).toMatch(/^[\w@%+=:,./ -]{1,300}$/);
    mkdirSync(join(d, "node_modules", "@opennextjs", "cloudflare"), { recursive: true });
    writeFileSync(join(d, "node_modules", "@opennextjs", "cloudflare", "package.json"), "{}");
    expect(mod.openNextInstallCmd(d, "npm")).toBeNull();
  });
});

describe("OpenNext next peer auto-bump (build workspace only)", () => {
  it("accepts patched 15.x and 16.x floors and rejects older pins", () => {
    expect(mod.nextSatisfiesOpenNext("15.5.28")).toBe(true);
    expect(mod.nextSatisfiesOpenNext("^15.5.30")).toBe(true);
    expect(mod.nextSatisfiesOpenNext("15.5.27")).toBe(false);
    expect(mod.nextSatisfiesOpenNext("16.4.1")).toBe(true);
    expect(mod.nextSatisfiesOpenNext("16.4.3")).toBe(true);
    expect(mod.nextSatisfiesOpenNext("16.2.4")).toBe(false);
    expect(mod.nextSatisfiesOpenNext("14.2.5")).toBe(false);
  });
  it("targets 15.5.28 for 15.x and 16.4.3 for 16.x / unknown", () => {
    expect(mod.targetNextForOpenNext("15.1.0")).toBe(mod.OPENNEXT_NEXT_MIN_15);
    expect(mod.targetNextForOpenNext("16.2.4")).toBe(mod.OPENNEXT_NEXT_MIN_16);
    expect(mod.targetNextForOpenNext("^16.0.0")).toBe(mod.OPENNEXT_NEXT_MIN_16);
  });
  it("rewrites next + eslint-config-next and returns a non-force install command", () => {
    const d = repo({
      dependencies: { next: "16.2.4", react: "19.2.4", "react-dom": "19.2.4" },
      devDependencies: { "eslint-config-next": "16.2.4" },
    });
    const r = mod.ensureNextForOpenNext(d, "npm");
    expect(r).not.toBeNull();
    expect(r!.from).toBe("16.2.4");
    expect(r!.to).toBe("16.4.3");
    expect(r!.bumped.map((b) => b.name).sort()).toEqual(["eslint-config-next", "next"]);
    expect(r!.installCmd).toBe("npm install next@16.4.3 eslint-config-next@16.4.3 react@19.2.4 react-dom@19.2.4");
    expect(r!.installCmd).not.toMatch(/--force/);
    expect(r!.installCmd).toMatch(/^[\w@%+=:,./ -]{1,300}$/);
    const pkg = JSON.parse(readFileSync(join(d, "package.json"), "utf8"));
    expect(pkg.dependencies.next).toBe("16.4.3");
    expect(pkg.devDependencies["eslint-config-next"]).toBe("16.4.3");
    expect(pkg.dependencies.react).toBe("19.2.4");
  });
  it("is a no-op when next already satisfies the peer", () => {
    const d = repo({ dependencies: { next: "16.4.2", react: "19.3.1" } });
    expect(mod.ensureNextForOpenNext(d, "npm")).toBeNull();
    expect(JSON.parse(readFileSync(join(d, "package.json"), "utf8")).dependencies.next).toBe("16.4.2");
  });
  it("uses pnpm/yarn/bun add forms without --force", () => {
    for (const [pm, prefix] of [["pnpm", "pnpm add"], ["yarn", "yarn add"], ["bun", "bun add"]] as const) {
      const d = repo({ dependencies: { next: "15.5.0" } });
      const r = mod.ensureNextForOpenNext(d, pm);
      expect(r!.to).toBe("15.5.28");
      expect(r!.installCmd.startsWith(prefix)).toBe(true);
      expect(r!.installCmd).toContain("next@15.5.28");
      expect(r!.installCmd).not.toMatch(/--force/);
    }
  });
});

describe("sanitize @vercel/otel + ERESOLVE retry helpers", () => {
  it("bumps @vercel/otel 1.x to 2.2.1 and leaves 2.x alone", () => {
    const d = repo({ dependencies: { next: "16.4.3", "@vercel/otel": "^1.12.0" } });
    const r = mod.sanitizeVercelOtel(d, undefined);
    expect(r!.notes[0]).toContain("@vercel/otel ^1.12.0 → 2.2.1");
    expect(JSON.parse(readFileSync(join(d, "package.json"), "utf8")).dependencies["@vercel/otel"]).toBe("2.2.1");
    expect(mod.sanitizeVercelOtel(d, undefined)).toBeNull();
  });
  it("detects ERESOLVE in English and Thai install logs", () => {
    expect(mod.isEresolveLog("npm error code ERESOLVE\nnpm error")).toBe(true);
    expect(mod.isEresolveLog("Conflicting peer dependency: @opentelemetry/api-logs")).toBe(true);
    expect(mod.isEresolveLog("แก้ไขข้อขัดแย้งของ dependency ต้นทาง หรือลองใหม่อีกครั้ง\n--legacy-peer-deps")).toBe(true);
    expect(mod.isEresolveLog("added 10 packages")).toBe(false);
  });
  it("rewrites npm ci/install to --legacy-peer-deps and ignores other package managers", () => {
    expect(mod.withLegacyPeerDeps("npm ci")).toBe("npm install --legacy-peer-deps");
    expect(mod.withLegacyPeerDeps("npm install")).toBe("npm install --legacy-peer-deps");
    expect(mod.withLegacyPeerDeps("npm install --legacy-peer-deps")).toBeNull();
    expect(mod.withLegacyPeerDeps("pnpm install --frozen-lockfile")).toBeNull();
    expect(mod.withLegacyPeerDeps("bun install")).toBeNull();
  });
});

describe("build command hard timeout + process-group kill", () => {
  it("exports install/build/stall timeouts under the 15 min outer cap", () => {
    expect(mod.INSTALL_CMD_TIMEOUT_MS).toBe(8 * 60_000);
    expect(mod.BUILD_CMD_TIMEOUT_MS).toBe(12 * 60_000);
    expect(mod.BUILD_STALL_MS).toBe(4 * 60_000);
  });
  it("killProcessTree signals the process group (-pid) and falls back to child.kill", () => {
    const killed: Array<{ pid: number; sig: string }> = [];
    const orig = process.kill;
    (process as NodeJS.Process).kill = ((pid: number, sig?: string | number) => {
      killed.push({ pid, sig: String(sig ?? "") });
      return true;
    }) as typeof process.kill;
    try {
      mod.killProcessTree({ pid: 4242 }, "SIGTERM");
      expect(killed).toEqual([{ pid: -4242, sig: "SIGTERM" }]);
      killed.length = 0;
      (process as NodeJS.Process).kill = (() => {
        throw new Error("esrch");
      }) as typeof process.kill;
      const calls: string[] = [];
      mod.killProcessTree({ pid: 7, kill: (s?: string) => { calls.push(String(s)); } }, "SIGKILL");
      expect(calls).toEqual(["SIGKILL"]);
    } finally {
      process.kill = orig;
    }
  });
});

describe("fixRecursiveOpenNextBuildScript", () => {
  it("rewrites scripts.build from opennextjs-cloudflare to next build", () => {
    const d = repo({ scripts: { build: "opennextjs-cloudflare build", preview: "opennextjs-cloudflare preview" }, dependencies: { next: "16.4.3" } });
    const r = mod.fixRecursiveOpenNextBuildScript(d, undefined);
    expect(r).toEqual({ from: "opennextjs-cloudflare build", to: "next build" });
    expect(JSON.parse(readFileSync(join(d, "package.json"), "utf8")).scripts.build).toBe("next build");
    expect(mod.fixRecursiveOpenNextBuildScript(d, undefined)).toBeNull();
  });
  it("leaves plain next build alone", () => {
    const d = repo({ scripts: { build: "next build" }, dependencies: { next: "16.4.3" } });
    expect(mod.fixRecursiveOpenNextBuildScript(d, undefined)).toBeNull();
  });
});
