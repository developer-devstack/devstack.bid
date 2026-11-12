import { connection } from "next/server";
import { cursorOriginConfigured, loadCursorOriginServer } from "@/lib/auth/cursor-origin-server";
import { json } from "@/lib/chat/runtime";
import { getAccount } from "@/lib/chat/store";
import { gate, isResponse } from "@/lib/connections/route-kit";

/** GET /api/cursor/status — whether this user can list Origin repos (Cursor sign-in + server keys). */
export async function GET(req: Request) {
  await connection();
  const a = await gate(req, { write: false, burstKey: "cursor-st", perMinute: 60 });
  if (isResponse(a)) return a;
  const account = await getAccount(a.db, a.uid);
  const configured = cursorOriginConfigured();
  const srv = configured ? await loadCursorOriginServer(a.db, a.uid) : null;
  return json(
    {
      configured,
      provider: account?.provider ?? null,
      linked: !!srv,
      canList: !!(account?.provider === "cursor" && srv),
    },
    200,
    { "Cache-Control": "no-store" },
  );
}
