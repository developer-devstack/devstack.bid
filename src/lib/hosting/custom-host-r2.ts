/** R2 index for verified custom hostnames (no server-only — shared with sites-worker). */
import type { R2BucketLike } from "./serve";

export const CUSTOM_HOST_PREFIX = "custom-hosts/";

export function normalizeHostname(raw: string): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, "")
    .replace(/\.$/, "");
}

export function customHostKey(hostname: string): string {
  return `${CUSTOM_HOST_PREFIX}${normalizeHostname(hostname)}.json`;
}

export interface HostAliasRecord {
  projectId: string;
  deploymentId: string;
  worker?: string;
  updatedAt: number;
}

export async function readCustomHostRecord(bucket: R2BucketLike, hostname: string): Promise<HostAliasRecord | null> {
  const o = await bucket.get(customHostKey(hostname));
  if (!o) return null;
  const text = o.text ? await o.text() : await new Response(o.body).text();
  try {
    const j = JSON.parse(text) as HostAliasRecord;
    if (!j.projectId || !j.deploymentId) return null;
    return j;
  } catch {
    return null;
  }
}

export async function writeCustomHostRecord(
  bucket: R2BucketLike,
  hostname: string,
  projectId: string,
  deploymentId: string,
  worker?: string,
): Promise<void> {
  const body: HostAliasRecord = { projectId, deploymentId, updatedAt: Date.now(), ...(worker ? { worker } : {}) };
  await bucket.put(customHostKey(hostname), JSON.stringify(body), { httpMetadata: { contentType: "application/json" } });
}

export async function deleteCustomHostRecord(bucket: R2BucketLike, hostname: string): Promise<void> {
  if (bucket.delete) await bucket.delete(customHostKey(hostname));
}
