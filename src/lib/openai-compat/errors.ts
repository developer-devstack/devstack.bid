import "server-only";
import { NO_STORE } from "@/lib/server/http";

/** OpenAI-shaped error body: `{ error: { message, type, param, code } }`. */
export type OpenAiErrorType =
  | "invalid_request_error"
  | "authentication_error"
  | "permission_error"
  | "rate_limit_error"
  | "server_error"
  | "api_error";

export function openAiError(
  status: number,
  message: string,
  opts: { type?: OpenAiErrorType; code?: string | null; param?: string | null; headers?: Record<string, string> } = {}
): Response {
  const type =
    opts.type ??
    (status === 401
      ? "authentication_error"
      : status === 403
        ? "permission_error"
        : status === 429
          ? "rate_limit_error"
          : status >= 500
            ? "server_error"
            : "invalid_request_error");
  return Response.json(
    { error: { message, type, param: opts.param ?? null, code: opts.code ?? null } },
    { status, headers: { ...NO_STORE, ...(opts.headers ?? {}) } }
  );
}
