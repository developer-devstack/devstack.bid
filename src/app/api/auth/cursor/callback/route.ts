import { issueSession } from "@/lib/auth/session";
import { connection } from "next/server";
import { originSigningKeys, verifyInstallationReceipt } from "@/lib/auth/cursor-receipt";
import { planSignIn } from "@/lib/auth/link-account";
import { oauthFail, readOAuthState, signedInRedirect } from "@/lib/auth/oauth-flow";
import { chatEnv } from "@/lib/chat/config";
import { OAUTH_STATE_COOKIE, readCookie } from "@/lib/chat/identity";
import { chatRuntime } from "@/lib/chat/runtime";
import { saveOAuthAccount } from "@/lib/chat/store";
import { serverEnv } from "@/lib/server/env";
import { clientIp } from "@/lib/server/http";
import { checkRateLimit } from "@/lib/server/rate-limit";

/** GET /api/auth/cursor/callback — verify the Origin installation receipt and set the session cookie. */
export async function GET(req: Request) {
  await connection();
  const url = new URL(req.url);
  const secure = url.protocol === "https:";
  const server = serverEnv();
  const chat = chatEnv();
  const secret = chat.CHAT_COOKIE_SECRET;
  if (!server.CURSOR_APP_ID || !secret) return oauthFail(url.origin, secure, "missing", "cursor");
  const burst = await checkRateLimit("NVX_CHAT_LIMITER", `authcb:${clientIp(req)}`, 10);
  if (!burst.ok) return oauthFail(url.origin, secure, "error", "cursor");

  // Cursor may return `error` when the user denies the install.
  if (url.searchParams.get("error")) return oauthFail(url.origin, secure, "denied", "cursor");

  // Prefer the URL `state` Cursor echoes (and binds into the receipt JWT). The
  // nvx_oauth_state cookie is often missing on Android after the cross-site
  // round-trip even though other Path=/ cookies arrive — fail closed only when
  // neither a signed query state nor a cookie is usable.
  const queryState = url.searchParams.get("state") ?? "";
  const cookie = readCookie(req.headers.get("cookie"), OAUTH_STATE_COOKIE) ?? "";
  const signedState = queryState || cookie;
  const opened = signedState ? await readOAuthState(signedState, cookie || undefined, secret, "cursor") : null;
  const receipt = url.searchParams.get("installation_receipt") ?? "";
  if (!opened || !signedState || receipt.length < 20 || receipt.length > 8000) {
    console.warn(JSON.stringify({ at: "api/auth/cursor", event: "reject", reason: !opened ? "state" : "receipt" }));
    return oauthFail(url.origin, secure, "error", "cursor");
  }
  const { db } = await chatRuntime();
  if (!db) return oauthFail(url.origin, secure, "error", "cursor");
  try {
    const identity = await verifyInstallationReceipt(receipt, {
      appId: server.CURSOR_APP_ID,
      keys: await originSigningKeys(),
      state: signedState,
    });
    if (!identity) {
      console.warn(JSON.stringify({ at: "api/auth/cursor", event: "reject", reason: "receipt_verify" }));
      return oauthFail(url.origin, secure, "error", "cursor");
    }
    const plan = await planSignIn(db, req, secret, "cursor", identity.subject);
    await saveOAuthAccount(db, plan, {
      provider: "cursor",
      subject: identity.subject,
      login: identity.login,
      name: identity.name,
      email: identity.email,
      avatarUrl: null,
    });
    console.warn(JSON.stringify({ at: "api/auth/cursor", event: "linked" }));
    return signedInRedirect(url.origin, secure, opened.next, await issueSession(db, plan.userId, secret));
  } catch (err) {
    const msg = err instanceof Error ? `${err.name}:${err.message}`.slice(0, 120) : "unknown";
    console.warn(JSON.stringify({ at: "api/auth/cursor", event: "failed", name: msg }));
    return oauthFail(url.origin, secure, "error", "cursor");
  }
}
