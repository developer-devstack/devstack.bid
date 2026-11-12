import "server-only";
import { signCursorAppJwt } from "@/lib/auth/cursor-app-jwt";
import { socketFetch } from "@/lib/server/socket-fetch";

export const ORIGIN_API = "https://api.cursor.com/v1/origin";

export class CursorOriginError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export type OriginRepo = {
  id: string;
  fullName: string;
  name: string;
  defaultBranch: string;
  private: boolean;
  updatedAt: string | null;
};

async function originFetch(
  path: string,
  bearer: string,
  init: RequestInit = {},
  f: typeof fetch = fetch,
): Promise<Response> {
  let res = await f(`${ORIGIN_API}${path}`, { ...init, headers: { Accept: "application/json", Authorization: `Bearer ${bearer}`, ...(init.headers ?? {}) } });
  if (res.status === 525) res = await socketFetch(`${ORIGIN_API}${path}`, { ...init, headers: { Accept: "application/json", Authorization: `Bearer ${bearer}`, ...(init.headers ?? {}) } }).catch(() => res);
  return res;
}

export async function createInstallationAccessToken(
  appId: string,
  signingKeyDer: Uint8Array,
  installationId: string,
  scopes: string[],
  repositoryIds?: string[],
  f: typeof fetch = fetch,
): Promise<string> {
  const appJwt = await signCursorAppJwt(appId, signingKeyDer);
  const body: Record<string, unknown> = {};
  if (scopes.length) body.scopes = scopes;
  if (repositoryIds?.length) body.repositoryIds = repositoryIds;
  const res = await originFetch(`/app/installations/${encodeURIComponent(installationId)}/access_tokens`, appJwt, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, f);
  if (!res.ok) throw new CursorOriginError(res.status, `access_token:${res.status}`);
  const data = (await res.json()) as { token?: string };
  if (!data.token || typeof data.token !== "string") throw new CursorOriginError(502, "access_token:missing");
  return data.token;
}

export async function listInstallationRepos(
  installToken: string,
  q: string,
  page: number,
  f: typeof fetch = fetch,
): Promise<{ repos: OriginRepo[]; hasMore: boolean }> {
  const u = new URL(`${ORIGIN_API}/installation/repos`);
  if (q) u.searchParams.set("q", q.slice(0, 100));
  u.searchParams.set("page", String(Math.max(1, page)));
  u.searchParams.set("per_page", "30");
  let res = await f(u.toString(), { headers: { Accept: "application/json", Authorization: `Bearer ${installToken}` } });
  if (res.status === 525) res = await socketFetch(u.toString(), { headers: { Accept: "application/json", Authorization: `Bearer ${installToken}` } }).catch(() => res);
  if (!res.ok) throw new CursorOriginError(res.status, `repos:${res.status}`);
  const body = (await res.json()) as {
    repositories?: Array<{ id?: string; fullName?: string; name?: string; defaultBranch?: string; visibility?: string }>;
    pageInfo?: { hasNextPage?: boolean };
  };
  const repos = (body.repositories ?? []).flatMap((r) => {
    if (!r.id || !r.fullName || !r.name) return [];
    return [{
      id: r.id,
      fullName: r.fullName,
      name: r.name,
      defaultBranch: r.defaultBranch ?? "main",
      private: r.visibility === "private",
      updatedAt: null,
    }];
  });
  const needle = q.trim().toLowerCase();
  const filtered = needle ? repos.filter((r) => r.fullName.toLowerCase().includes(needle)) : repos;
  return { repos: filtered, hasMore: !!body.pageInfo?.hasNextPage };
}

/** Download and gunzip an Origin repo tarball for `ref` (default branch when omitted). */
export async function fetchOriginTarball(installToken: string, fullName: string, ref: string, f: typeof fetch = fetch): Promise<Uint8Array> {
  const [owner, name] = fullName.split("/", 2);
  if (!owner || !name) throw new CursorOriginError(400, "invalid_repo");
  const path = ref.includes("/")
    ? `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/tarball?ref=${encodeURIComponent(ref)}`
    : `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/tarball/${encodeURIComponent(ref)}`;
  let res = await originFetch(path, installToken, { headers: { Accept: "application/gzip, application/octet-stream" } }, f);
  if (res.status === 302 && res.headers.get("location")) {
    const loc = res.headers.get("location")!;
    res = await f(loc, { headers: { Accept: "application/gzip, application/octet-stream" } });
  }
  if (!res.ok) throw new CursorOriginError(res.status, `tarball:${res.status}`);
  const gz = new Uint8Array(await res.arrayBuffer());
  const ds = new DecompressionStream("gzip");
  const tar = new Uint8Array(await new Response(new Blob([gz]).stream().pipeThrough(ds)).arrayBuffer());
  return tar;
}
