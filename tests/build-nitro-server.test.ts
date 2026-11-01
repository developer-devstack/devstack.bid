import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let mod: {
  detectServerArtifact(dir: string, out: string): { kind: string; main: string; assets: string } | null;
};

beforeAll(async () => {
  process.env.BUILD_SERVER_NO_LISTEN = "1";
  mod = await import("../container/build-server.mjs");
});

const tmp = () => mkdtempSync(join(tmpdir(), "nitro-"));

describe("detectServerArtifact", () => {
  it("detects OpenNext under .open-next", () => {
    const d = tmp();
    mkdirSync(join(d, ".open-next", "assets"), { recursive: true });
    writeFileSync(join(d, ".open-next", "worker.js"), "export default {}");
    const r = mod.detectServerArtifact(d, join(d, "dist"));
    expect(r).toMatchObject({ kind: "opennext" });
    expect(r!.main).toContain(".open-next/worker.js");
  });

  it("detects Nitro/Nuxt .output/server/index.mjs + public", () => {
    const d = tmp();
    mkdirSync(join(d, ".output", "server"), { recursive: true });
    mkdirSync(join(d, ".output", "public", "_nuxt"), { recursive: true });
    writeFileSync(join(d, ".output", "server", "index.mjs"), "export default {}");
    writeFileSync(join(d, ".output", "public", "favicon.ico"), "x");
    const out = join(d, ".output", "public");
    const r = mod.detectServerArtifact(d, out);
    expect(r).toMatchObject({ kind: "nitro" });
    expect(r!.main).toBe(join(d, ".output", "server", "index.mjs"));
    expect(r!.assets).toBe(out);
  });

  it("returns null when only static files without index are missing server entry", () => {
    const d = tmp();
    mkdirSync(join(d, "dist"), { recursive: true });
    expect(mod.detectServerArtifact(d, join(d, "dist"))).toBeNull();
  });

  it("prefers OpenNext over Nitro when both exist", () => {
    const d = tmp();
    mkdirSync(join(d, ".open-next", "assets"), { recursive: true });
    writeFileSync(join(d, ".open-next", "worker.js"), "export default {}");
    mkdirSync(join(d, ".output", "server"), { recursive: true });
    mkdirSync(join(d, ".output", "public"), { recursive: true });
    writeFileSync(join(d, ".output", "server", "index.mjs"), "export default {}");
    expect(mod.detectServerArtifact(d, join(d, ".output", "public"))!.kind).toBe("opennext");
  });
});
