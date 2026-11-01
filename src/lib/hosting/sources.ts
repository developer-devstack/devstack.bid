/**
 * Project source archives on R2 (SITES or BUILD_ARTIFACTS).
 * DevStack hosting keeps source of truth here — never creates GitHub repos or pushes.
 *
 * Layout:
 *   sources/<projectId>/latest.tar
 *   sources/<projectId>/meta.json  { sha256, files, updatedAt }
 */
import type { R2BucketLike } from "./serve";
import { writeTar, type TarFile } from "@/lib/build/tar";

export const sourceTarKey = (projectId: string) => `sources/${projectId}/latest.tar`;
export const sourceMetaKey = (projectId: string) => `sources/${projectId}/meta.json`;

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function putProjectSource(
  bucket: R2BucketLike,
  projectId: string,
  files: TarFile[],
): Promise<{ key: string; sha256: string; files: number; bytes: number }> {
  const tar = writeTar(files);
  const sha = await sha256Hex(tar);
  await bucket.put(sourceTarKey(projectId), tar, { httpMetadata: { contentType: "application/x-tar" } });
  await bucket.put(
    sourceMetaKey(projectId),
    JSON.stringify({ sha256: sha, files: files.length, bytes: tar.length, updatedAt: Date.now() }),
    { httpMetadata: { contentType: "application/json" } },
  );
  return { key: sourceTarKey(projectId), sha256: sha, files: files.length, bytes: tar.length };
}

export async function getProjectSourceTar(bucket: R2BucketLike, projectId: string): Promise<Uint8Array | null> {
  const obj = await bucket.get(sourceTarKey(projectId));
  if (!obj) return null;
  const abFn = (obj as unknown as { arrayBuffer?: () => Promise<ArrayBuffer> }).arrayBuffer;
  if (typeof abFn === "function") return new Uint8Array(await abFn.call(obj));
  if (obj.body) {
    const ab = await new Response(obj.body).arrayBuffer();
    return new Uint8Array(ab);
  }
  return null;
}
