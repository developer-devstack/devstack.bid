import "server-only";
import { getCursorInstallation } from "@/lib/auth/cursor-installation";
import { createInstallationAccessToken } from "@/lib/auth/cursor-origin-client";
import { parseCursorSigningKey } from "@/lib/auth/cursor-app-jwt";
import type { D1Like } from "@/lib/chat/store";
import { serverEnv } from "@/lib/server/env";

export type CursorOriginServer = {
  appId: string;
  signingKey: Uint8Array;
  installationId: string;
};

/** App signing key + stored installation for API calls on behalf of the signed-in user. */
export async function loadCursorOriginServer(db: D1Like, userId: string): Promise<CursorOriginServer | null> {
  const env = serverEnv();
  const rawKey = process.env.CURSOR_APP_SIGNING_KEY?.trim();
  if (!env.CURSOR_APP_ID || !rawKey) return null;
  const installationId = await getCursorInstallation(db, userId);
  if (!installationId) return null;
  try {
    return { appId: env.CURSOR_APP_ID, signingKey: parseCursorSigningKey(rawKey), installationId };
  } catch {
    return null;
  }
}

export async function cursorInstallToken(
  srv: CursorOriginServer,
  scopes: string[],
  repositoryIds?: string[],
): Promise<string> {
  return createInstallationAccessToken(srv.appId, srv.signingKey, srv.installationId, scopes, repositoryIds);
}

export function cursorOriginConfigured(): boolean {
  const env = serverEnv();
  return !!(env.CURSOR_APP_ID && process.env.CURSOR_APP_SIGNING_KEY?.trim());
}
