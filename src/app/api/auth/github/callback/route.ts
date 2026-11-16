import { issueSession } from "@/lib/auth/session";
import { connection } from "next/server";
import { exchangeCodeWithScope, fetchProfile } from "@/lib/auth/github-api";
import { GITHUB_SCOPES, grantedScopes } from "@/lib/auth/github-policy";
import { planSignIn } from "@/lib/auth/link-account";
import { oauthFail, oauthLinkedRedirect, readOAuthState, signedInRedirect } from "@/lib/auth/oauth-flow";
import { seal, resolveSealKeys } from "@/lib/connections/credentials";
import { chatEnv } from "@/lib/chat/config";
import { OAUTH_STATE_COOKIE, readCookie } from "@/lib/chat/identity";
import { chatRuntime } from "@/lib/chat/runtime";
import { saveGithubCredentialLink, saveOAuthAccount } from "@/lib/chat/store";
import { resolveSignedIn } from "@/lib/auth/session";
import { serverEnv } from "@/lib/server/env";
import { clientIp } from "@/lib/server/http";
import { checkRateLimit } from "@/lib/server/rate-limit";

/** GET /api/auth/github/callback — exchange the code, link chats, set the session cookie. */
export async function GET(req: Request) {
  await connection();
  const url = new URL(req.url);
  const secure = url.protocol === "https:";
  const server = serverEnv();
  const chat = chatEnv();
  const secret = chat.CHAT_COOKIE_SECRET;
  if (!server.GITHUB_CLIENT_ID || !server.GITHUB_CLIENT_SECRET || !secret) return oauthFail(url.origin, secure, "missing", "github");
  const burst = await checkRateLimit("NVX_CHAT_LIMITER", `authcb:${clientIp(req)}`, 10);
  if (!burst.ok) return oauthFail(url.origin, secure, "error", "github");
  if (url.searchParams.get("error")) return oauthFail(url.origin, secure, "denied", "github");
  const opened = await readOAuthState(url.searchParams.get("state") ?? "", readCookie(req.headers.get("cookie"), OAUTH_STATE_COOKIE), secret, "github");
  if (!opened) return oauthFail(url.origin, secure, "error", "github");
  const code = url.searchParams.get("code") ?? "";
  if (!/^[\w.-]{8,200}$/.test(code)) return oauthFail(url.origin, secure, "error", "github", opened?.next);
  const { db } = await chatRuntime();
  if (!db) return oauthFail(url.origin, secure, "error", "github", opened?.next);
  try {
    const { token, scope } = await exchangeCodeWithScope({
      clientId: server.GITHUB_CLIENT_ID,
      clientSecret: server.GITHUB_CLIENT_SECRET,
      code,
      redirectUri: `${url.origin}/api/auth/github/callback`,
    });
    const profile = await fetchProfile(token);
    const keys = await resolveSealKeys(secret);
    const scopeGranted = grantedScopes(scope, GITHUB_SCOPES);
    if (opened.link) {
      const actor = await resolveSignedIn(req, secret);
      if (actor.uid && actor.authenticated) {
        await saveGithubCredentialLink(db, actor.uid, {
          tokenEnc: await seal(keys, "github", actor.uid, token),
          scope: scopeGranted,
        });
        console.warn(JSON.stringify({ at: "api/auth/github", event: "linked_to_session", login: profile.login, uid: actor.uid }));
        return oauthLinkedRedirect(url.origin, secure, opened.next);
      }
    }
    const plan = await planSignIn(db, req, secret, "github", profile.id);
    const cred = { tokenEnc: await seal(keys, "github", plan.userId, token), scope: scopeGranted };
    await saveOAuthAccount(
      db,
      plan,
      { provider: "github", subject: profile.id, login: profile.login, name: profile.name, email: profile.email, avatarUrl: profile.avatarUrl },
      cred,
    );
    console.warn(JSON.stringify({ at: "api/auth/github", event: "linked", login: profile.login }));
    return signedInRedirect(url.origin, secure, opened.next, await issueSession(db, plan.userId, secret));
  } catch (err) {
    console.warn(JSON.stringify({ at: "api/auth/github", event: "failed", name: (err as Error)?.name, status: (err as { status?: number }).status, step: (err as { step?: string }).step, ghError: (err as { ghError?: string }).ghError }));
    return oauthFail(url.origin, secure, "error", "github", opened?.next);
  }
}
