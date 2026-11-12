import type { D1Like } from "@/lib/chat/store";

/** Persist the Origin installation id from a verified installation receipt (sign-in). */
export async function saveCursorInstallation(db: D1Like, userId: string, installationId: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO cursor_installations (user_id, installation_id, updated_at) VALUES (?1, ?2, unixepoch('subsec') * 1000)
       ON CONFLICT (user_id) DO UPDATE SET installation_id = excluded.installation_id, updated_at = excluded.updated_at`,
    )
    .bind(userId, installationId)
    .run();
}

export async function getCursorInstallation(db: D1Like, userId: string): Promise<string | null> {
  const row = await db.prepare("SELECT installation_id FROM cursor_installations WHERE user_id = ?1").bind(userId).first<{ installation_id: string }>();
  return row?.installation_id ?? null;
}
