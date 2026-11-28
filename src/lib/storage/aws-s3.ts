import { AwsClient } from "aws4fetch";
import type { R2BucketLike } from "@/lib/hosting/serve";

export interface AwsS3Env {
  AWS_S3_BUCKET?: unknown;
  AWS_S3_REGION?: unknown;
  AWS_ACCESS_KEY_ID?: unknown;
  AWS_SECRET_ACCESS_KEY?: unknown;
  AWS_SESSION_TOKEN?: unknown;
}

type StoredObject = NonNullable<Awaited<ReturnType<R2BucketLike["get"]>>> & {
  arrayBuffer(): Promise<ArrayBuffer>;
};

function isText(value: unknown): value is string {
  return typeof value === "string";
}

function objectUrl(bucket: string, region: string, key: string): string {
  const encoded = key.split("/").map((part) => encodeURIComponent(part)).join("/");
  return `https://${bucket}.s3.${region}.amazonaws.com/${encoded}`;
}

/** AWS S3 adapter with the small WebCrypto-only SigV4 signer, compatible with Workers. */
export function createAwsS3Bucket(env: AwsS3Env): R2BucketLike | null {
  const bucket = isText(env.AWS_S3_BUCKET) ? env.AWS_S3_BUCKET.trim() : "";
  const region = isText(env.AWS_S3_REGION) ? env.AWS_S3_REGION.trim() : "";
  const accessKeyId = isText(env.AWS_ACCESS_KEY_ID) ? env.AWS_ACCESS_KEY_ID.trim() : "";
  const secretAccessKey = isText(env.AWS_SECRET_ACCESS_KEY) ? env.AWS_SECRET_ACCESS_KEY : "";
  const sessionToken = isText(env.AWS_SESSION_TOKEN) ? env.AWS_SESSION_TOKEN : "";
  if (!bucket || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) || !region || !accessKeyId || !secretAccessKey) return null;

  const client = new AwsClient({
    accessKeyId,
    secretAccessKey,
    ...(sessionToken ? { sessionToken } : {}),
    region,
    service: "s3",
    retries: 2,
  });

  return {
    async put(key, value, opts) {
      let body: string | ArrayBuffer | ArrayBufferView;
      if (value instanceof ReadableStream) {
        body = await new Response(value).arrayBuffer();
      } else {
        body = value;
      }
      const response = await client.fetch(objectUrl(bucket, region, key), {
        method: "PUT",
        headers: opts?.httpMetadata?.contentType ? { "Content-Type": opts.httpMetadata.contentType } : undefined,
        body: body as BodyInit,
      });
      if (!response.ok) throw new Error(`S3 PutObject failed (${response.status})`);
    },
    async get(key) {
      const response = await client.fetch(objectUrl(bucket, region, key), { method: "GET" });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`S3 GetObject failed (${response.status})`);
      const stored: StoredObject = {
        body: response.body ?? new ReadableStream(),
        httpEtag: response.headers.get("etag") ?? undefined,
        size: Number(response.headers.get("content-length") ?? 0),
        httpMetadata: { contentType: response.headers.get("content-type") ?? undefined },
        async text() { return response.clone().text(); },
        async arrayBuffer() { return response.clone().arrayBuffer(); },
        async json<T>() { return response.clone().json() as Promise<T>; },
      };
      return stored;
    },
    async delete(key) {
      const response = await client.fetch(objectUrl(bucket, region, key), { method: "DELETE" });
      if (!response.ok) throw new Error(`S3 DeleteObject failed (${response.status})`);
    },
  };
}
