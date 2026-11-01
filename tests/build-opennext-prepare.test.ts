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
  OPENNEXT_NEXT_MIN_15: string;
  OPENNEXT_NEXT_MIN_16: string;
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
