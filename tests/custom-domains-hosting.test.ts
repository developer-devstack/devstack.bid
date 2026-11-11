import { describe, expect, it, vi } from "vitest";
import { validateCustomHostname, challengeRecordName } from "@/lib/hosting/custom-domains";
import { writeCustomHostRecord } from "@/lib/hosting/custom-host-r2";
import { parseServerBindings, workerBindingsFromSpec } from "@/lib/hosting/server-bindings";
import { promoteProduction, writeSite } from "@/lib/hosting/publish";
import { serveSite, type R2BucketLike } from "@/lib/hosting/serve";

function memBucket(): R2BucketLike {
  const m = new Map<string, Uint8Array>();
  return {
    async get(key) {
      const v = m.get(key);
      if (!v) return null;
      return { body: new Response(v as BlobPart).body!, text: async () => new TextDecoder().decode(v) };
    },
    async put(key, value) {
      const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value instanceof Uint8Array ? value : new Uint8Array(value as ArrayBuffer);
      m.set(key, bytes);
    },
    async delete(key) {
      m.delete(key);
    },
  };
}

const enc = (s: string) => new TextEncoder().encode(s);
const DEP = "0f3a9c2e-1111-4222-8333-944455556666";

describe("custom hostnames", () => {
  it("validates external FQDNs only", () => {
    expect(validateCustomHostname("app.example.com")).toBe("app.example.com");
    expect(validateCustomHostname("my-app.devstack.bid")).toBeNull();
    expect(validateCustomHostname("not a host")).toBeNull();
    expect(challengeRecordName("app.example.com")).toBe("_devstack-challenge.app.example.com");
  });

  it("serves static content on a custom hostname via R2 index", async () => {
    const b = memBucket();
    await writeSite(b, DEP, [{ path: "index.html", bytes: enc("<h1>custom</h1>") }]);
    await promoteProduction(b, "my-app", "proj-1", DEP);
    await writeCustomHostRecord(b, "shop.example.com", "proj-1", DEP);
    const r = await serveSite(new Request("https://shop.example.com/"), b);
    expect(r.status).toBe(200);
    expect(await r.text()).toContain("custom");
  });

  it("parses server binding whitelist", () => {
    expect(parseServerBindings('{"ai":true,"evil":1}')).toEqual({ ai: true });
    expect(workerBindingsFromSpec({ ai: true })).toEqual([{ type: "ai", name: "AI" }]);
  });

  it("dns challenge helper accepts matching TXT", async () => {
    const { dnsTxtContainsToken } = await import("@/lib/hosting/custom-domains");
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({ Answer: [{ data: '"tok-abc"' }] }), { status: 200 }),
    ) as unknown as typeof fetch;
    await expect(dnsTxtContainsToken("app.example.com", "tok-abc", fetcher)).resolves.toBe(true);
  });
});
