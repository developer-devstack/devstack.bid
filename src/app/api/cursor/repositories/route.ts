import { connection } from "next/server";
import { CursorOriginError, listInstallationRepos } from "@/lib/auth/cursor-origin-client";
import { cursorInstallToken, loadCursorOriginServer } from "@/lib/auth/cursor-origin-server";
import { json } from "@/lib/chat/runtime";
import { getAccount } from "@/lib/chat/store";
import { gate, isResponse } from "@/lib/connections/route-kit";

/** GET /api/cursor/repositories?q=&page= — Origin repos granted to the DevStack app for this user. */
export async function GET(req: Request) {
  await connection();
  const a = await gate(req, { write: false, burstKey: "cursor-repos", perMinute: 30 });
  if (isResponse(a)) return a;
  const account = await getAccount(a.db, a.uid);
  if (account?.provider !== "cursor") {
    return json({ error: "Sign in with Cursor to list Origin repositories. / ล็อกอินด้วย Cursor ก่อน", code: "reauth", connected: false }, 401);
  }
  const srv = await loadCursorOriginServer(a.db, a.uid);
  if (!srv) {
    const unconfigured = !process.env.CURSOR_APP_SIGNING_KEY?.trim();
    return json(
      {
        error: unconfigured
          ? "Cursor import is not configured on this server yet."
          : "Cursor installation missing. Sign in with Cursor again. / ติดตั้ง Cursor อีกครั้ง",
        code: unconfigured ? "unconfigured" : "reauth",
        connected: false,
      },
      unconfigured ? 503 : 401,
    );
  }
  const u = new URL(req.url);
  const page = Number(u.searchParams.get("page") ?? 1) || 1;
  const q = u.searchParams.get("q") ?? "";
  try {
    const token = await cursorInstallToken(srv, ["repository:metadata:read", "repository:contents:read"]);
    const r = await listInstallationRepos(token, q, page);
    return json({ ...r, connected: true }, 200, { "Cache-Control": "no-store" });
  } catch (err) {
    if (err instanceof CursorOriginError && err.status === 401) {
      return json({ error: "Cursor installation expired. Sign in with Cursor again.", code: "reauth", connected: false }, 401);
    }
    if (err instanceof CursorOriginError && err.status === 403) {
      return json({ error: "Cursor denied access to these repositories.", code: "forbidden", connected: true }, 403);
    }
    return json({ error: "Could not list Cursor repositories.", code: "cursor" }, 502);
  }
}
