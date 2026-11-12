import { describe, expect, it } from "vitest";
import { parseCursorSigningKey, signCursorAppJwt } from "@/lib/auth/cursor-app-jwt";

describe("cursor origin app jwt", () => {
  it("signs a short-lived JWT with Ed25519", async () => {
    const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
    const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
    const jwt = await signCursorAppJwt("app_test123456", pkcs8, 1_700_000_000);
    expect(jwt.split(".")).toHaveLength(3);
    const parsed = parseCursorSigningKey(btoa(String.fromCharCode(...pkcs8)));
    expect(parsed.length).toBe(pkcs8.length);
  });
});
