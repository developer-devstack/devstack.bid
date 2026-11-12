import "server-only";

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const enc = (s: string) => new TextEncoder().encode(s);

/** PKCS#8 DER or PEM Ed25519 private key for the DevStack Origin app (never log or expose). */
export function parseCursorSigningKey(raw: string): Uint8Array {
  const t = raw.trim();
  if (t.includes("BEGIN PRIVATE KEY") || t.includes("BEGIN OPENSSH PRIVATE KEY")) {
    const b64 = t.replace(/-----(BEGIN|END) [\w ]+-----/g, "").replace(/\s/g, "");
    return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  }
  return Uint8Array.from(atob(t.replace(/\s/g, "")), (c) => c.charCodeAt(0));
}

/** Origin App JWT (`iss` + `kid` = app id, `aud` = origin-apps, ~5 min). */
export async function signCursorAppJwt(appId: string, pkcs8Der: Uint8Array, now = Math.floor(Date.now() / 1000)): Promise<string> {
  const key = await crypto.subtle.importKey("pkcs8", pkcs8Der.buffer.slice(pkcs8Der.byteOffset, pkcs8Der.byteOffset + pkcs8Der.byteLength) as ArrayBuffer, { name: "Ed25519" }, false, ["sign"]);
  const header = b64url(enc(JSON.stringify({ alg: "EdDSA", kid: appId, typ: "JWT" })));
  const payload = b64url(enc(JSON.stringify({ iss: appId, aud: "origin-apps", iat: now, exp: now + 300 })));
  const data = enc(`${header}.${payload}`);
  const sig = new Uint8Array(await crypto.subtle.sign("Ed25519", key, data));
  return `${header}.${payload}.${b64url(sig)}`;
}
