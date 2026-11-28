import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createAwsS3Bucket, type AwsS3Env } from "@/lib/storage/aws-s3";
import { resolveSignedIn } from "@/lib/auth/session";

import { chatEnv, chatRuntime, json } from "@/lib/chat/runtime";
import { newId } from "@/lib/chat/store";
import { clientIp } from "@/lib/server/http";
import { checkRateLimit } from "@/lib/server/rate-limit";

/**
 * POST /api/chat/attachments stores approved files in the configured AWS S3 bucket.
 */
const ALLOWED = /^(image\/(png|jpeg|webp|gif)|application\/pdf|text\/(plain|markdown|csv)|application\/json)$/;

export async function POST(req: Request) {
  const env = chatEnv();
  const max = env.MAX_ATTACHMENT_BYTES;
  const mb = Math.round((max / 1024 / 1024) * 10) / 10;
  const tooBig = () => json({ error: `File is too large (max ${mb} MB). / ไฟล์ใหญ่เกินไป (สูงสุด ${mb} MB)`, code: "too_large", maxBytes: max }, 413);

  const declared = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > max) return tooBig();
  if (!req.headers.get("content-length")) return json({ error: "Content-Length is required. / ต้องระบุขนาดไฟล์", code: "length_required" }, 411);
  const type = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!ALLOWED.test(type)) return json({ error: "This file type isn't supported. / ไม่รองรับไฟล์ประเภทนี้", code: "unsupported_type" }, 415);

  const ip = clientIp(req);
  const burst = await checkRateLimit("NVX_CHAT_LIMITER", ip, env.CHAT_BURST_PER_MIN);
  if (!burst.ok) return json({ error: "Too many uploads — wait a minute. / อัปโหลดถี่เกินไป กรุณารอสักครู่", code: "rate_limited" }, 429, { "Retry-After": "60" });

  let bucket: ReturnType<typeof createAwsS3Bucket> = null;
  try {
    const cf = await getCloudflareContext({ async: true });
    bucket = createAwsS3Bucket(cf.env as unknown as AwsS3Env);
  } catch {
    bucket = null;
  }
  if (!bucket) {
    return json(
      { error: "File uploads aren't available yet (storage is being set up). / ยังอัปโหลดไฟล์ไม่ได้ (กำลังเตรียมพื้นที่จัดเก็บ)", code: "uploads_disabled", maxBytes: max },
      503
    );
  }
  const { db } = await chatRuntime();
  if (!db || !env.CHAT_COOKIE_SECRET) return json({ error: "Storage unavailable", code: "no_database" }, 503);
  const actor = await resolveSignedIn(req, env.CHAT_COOKIE_SECRET, { issue: true });
  const uid = actor.uid!;
  const setCookie = actor.setCookie;

  // Read with a hard cap even if Content-Length lied.
  const reader = req.body?.getReader();
  if (!reader) return json({ error: "Empty body", code: "empty" }, 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      return tooBig();
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(size);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.byteLength;
  }
  const id = newId();
  const key = `u/${uid}/pending/${id}`;
  await bucket.put(key, buf.buffer as ArrayBuffer, { httpMetadata: { contentType: type } });
  return json({ id, size, mime: type }, 201, setCookie ? { "Set-Cookie": setCookie } : {});
}
