import "server-only";
import { gatewayChatStream } from "@/lib/ai/gateway";
import { hfChatStream, type ChatMsg } from "@/lib/ai/hf";
import { redactSecrets } from "@/lib/ai/openai";
import { waiChatStream, type AiBinding } from "@/lib/ai/workers-ai";
import type { ChatEnv } from "@/lib/chat/config";
import { quotaConfig } from "@/lib/chat/config";
import { consume, messageRules, refund, type LimitResult } from "@/lib/chat/limits";
import { chatEnv, chatRuntime } from "@/lib/chat/runtime";
import type { D1Like } from "@/lib/chat/store";
import { authenticateMcpClient, consumeMcpClient, isMcpKey, type McpClient } from "@/lib/mcp/auth";
import { clientIp, HttpError, NO_STORE, readJsonBody } from "@/lib/server/http";
import { serverEnv, type ServerEnv } from "@/lib/server/env";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { openAiError } from "./errors";
import { listCompatModels, resolveCompatModel, type CompatProvider } from "./models";

const MAX_BODY = 64 * 1024;
const MAX_MESSAGES = 40;
const MAX_CONTENT = 8_000;

export type OpenAiMessage = { role: string; content: unknown };

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "type" in part) {
          const p = part as { type?: string; text?: string };
          if (p.type === "text" && typeof p.text === "string") return p.text;
        }
        return "";
      })
      .join("");
  }
  return "";
}

export function normalizeMessages(raw: unknown, maxInputChars: number): ChatMsg[] | { error: string; param: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { error: "messages must be a non-empty array", param: "messages" };
  if (raw.length > MAX_MESSAGES) return { error: `messages may contain at most ${MAX_MESSAGES} items`, param: "messages" };
  const out: ChatMsg[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (!item || typeof item !== "object") return { error: `messages[${i}] must be an object`, param: "messages" };
    const role = String((item as OpenAiMessage).role ?? "");
    if (role !== "system" && role !== "user" && role !== "assistant") {
      return { error: `messages[${i}].role must be system, user, or assistant`, param: "messages" };
    }
    const text = textFromContent((item as OpenAiMessage).content).replace(/\u0000/g, "").trim();
    if (!text && role !== "assistant") return { error: `messages[${i}].content is empty`, param: "messages" };
    if (text.length > Math.min(MAX_CONTENT, maxInputChars)) {
      return { error: `messages[${i}].content exceeds ${Math.min(MAX_CONTENT, maxInputChars)} characters`, param: "messages" };
    }
    out.push({ role: role as ChatMsg["role"], content: text.slice(0, Math.min(MAX_CONTENT, maxInputChars)) });
  }
  if (!out.some((m) => m.role === "user")) return { error: "messages must include at least one user message", param: "messages" };
  return out;
}

async function aiBinding(): Promise<AiBinding | null> {
  try {
    return ((await getCloudflareContext({ async: true })).env as unknown as { AI?: AiBinding }).AI ?? null;
  } catch {
    return null;
  }
}

async function* runProvider(
  p: CompatProvider,
  messages: ChatMsg[],
  env: ChatEnv,
  server: ServerEnv,
  ai: AiBinding | null,
  maxTokens: number,
  signal?: AbortSignal
): AsyncGenerator<{ delta: string } | { usage: { input: number; output: number } }> {
  if (p.kind === "wai") {
    if (!ai) throw Object.assign(new Error("Workers AI is unavailable"), { status: 503, code: "unavailable" });
    yield* waiChatStream(ai, p.model, messages, maxTokens, env.CF_AI_GATEWAY_ID || undefined);
    return;
  }
  if (p.kind === "hf") {
    if (!server.HF_TOKEN) throw Object.assign(new Error("Hugging Face is not configured"), { status: 503, code: "unavailable" });
    for await (const chunk of hfChatStream({ messages, token: server.HF_TOKEN, model: p.model, maxTokens, signal })) {
      if ("delta" in chunk) yield { delta: chunk.delta };
      else if ("usage" in chunk) yield { usage: chunk.usage };
    }
    return;
  }
  if (!server.AI_GATEWAY_API_KEY) throw Object.assign(new Error("AI Gateway is not configured"), { status: 503, code: "unavailable" });
  yield* gatewayChatStream({
    messages,
    token: server.AI_GATEWAY_API_KEY,
    model: p.model,
    maxTokens,
    baseUrl: server.AI_GATEWAY_BASE_URL,
    signal,
  });
}

function completionId() {
  return `chatcmpl_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

function sseChunk(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

async function requireScope(req: Request, db: D1Like, needed: ("chat:write" | "chat:read")[]): Promise<McpClient | Response> {
  const auth = await authenticateMcpClient(req, db);
  if (!auth.client) {
    return openAiError(401, auth.error === "missing" ? "Missing Bearer API key. Create one at /settings/mcp." : "Invalid or revoked API key.", {
      code: "invalid_api_key",
    });
  }
  if (!isMcpKey(auth.client.scopes)) {
    return openAiError(403, "CLI keys cannot call /api/v1. Create an MCP key with chat scopes at /settings/mcp.", { code: "missing_scope" });
  }
  if (!needed.some((s) => auth.client!.scopes.includes(s))) {
    return openAiError(403, `This API key needs one of: ${needed.join(", ")}.`, { code: "missing_scope" });
  }
  const rate = await consumeMcpClient(db, auth.client);
  if (!rate.ok) {
    return openAiError(429, `API key rate limit reached. Retry in ${rate.retryAfter} seconds.`, {
      code: "rate_limit_exceeded",
      headers: { "Retry-After": String(rate.retryAfter) },
    });
  }
  return auth.client;
}

export async function handleListModels(req: Request): Promise<Response> {
  const { db } = await chatRuntime();
  if (!db) return openAiError(503, "Storage is unavailable.", { code: "unavailable" });
  const clientOrErr = await requireScope(req, db, ["chat:read", "chat:write"]);
  if (clientOrErr instanceof Response) return clientOrErr;
  const env = chatEnv();
  const server = serverEnv();
  return Response.json({ object: "list", data: listCompatModels(env, server) }, { headers: { ...NO_STORE } });
}

export async function handleChatCompletions(req: Request): Promise<Response> {
  if (req.method !== "POST") return openAiError(405, "Method not allowed", { code: "method_not_allowed" });

  const env = chatEnv();
  const server = serverEnv();
  const { db } = await chatRuntime();
  if (!db || env.CHAT_ENABLED !== "true") {
    return openAiError(503, "Chat is unavailable right now.", { code: "unavailable" });
  }

  const clientOrErr = await requireScope(req, db, ["chat:write"]);
  if (clientOrErr instanceof Response) return clientOrErr;
  const client = clientOrErr;

  let body: Record<string, unknown>;
  try {
    const parsed = await readJsonBody(req, MAX_BODY);
    body = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch (err) {
    if (err instanceof HttpError) return openAiError(err.status, err.message, { code: err.status === 413 ? "context_length_exceeded" : "invalid_request" });
    return openAiError(400, "Invalid JSON body", { code: "invalid_request" });
  }

  const messages = normalizeMessages(body.messages, env.CHAT_MAX_INPUT_CHARS);
  if ("error" in messages) return openAiError(400, messages.error, { code: "invalid_request", param: messages.param });

  const resolved = resolveCompatModel(typeof body.model === "string" ? body.model : undefined, env, server);
  if ("error" in resolved) return openAiError(400, resolved.error, { code: "model_not_found", param: resolved.param });

  const stream = body.stream === true;
  const maxTokensRaw = typeof body.max_tokens === "number" ? body.max_tokens : typeof body.max_completion_tokens === "number" ? body.max_completion_tokens : env.WAI_MAX_TOKENS;
  const maxTokens = Math.max(16, Math.min(env.WAI_MAX_TOKENS, Math.floor(Number(maxTokensRaw) || env.WAI_MAX_TOKENS)));

  const ip = clientIp(req);
  const rules = messageRules(ip, client.userId, quotaConfig(env));
  const lim: LimitResult = await consume(db, rules);
  if (!lim.ok) {
    return openAiError(429, "Chat quota reached for today. Retry after the daily reset (Asia/Bangkok midnight).", {
      code: "rate_limit_exceeded",
      headers: { "Retry-After": String(lim.retryAfterSec ?? 3600) },
    });
  }

  const ai = resolved.kind === "wai" ? await aiBinding() : null;
  const id = completionId();
  const created = Math.floor(Date.now() / 1000);
  const modelOut = resolved.id;

  try {
    if (stream) {
      const encoder = new TextEncoder();
      let usage = { prompt_tokens: 0, completion_tokens: 0 };
      const readable = new ReadableStream<Uint8Array>({
        async start(controller) {
          const send = (obj: unknown) => controller.enqueue(encoder.encode(sseChunk(obj)));
          try {
            send({
              id,
              object: "chat.completion.chunk",
              created,
              model: modelOut,
              choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
            });
            for await (const chunk of runProvider(resolved, messages, env, server, ai, maxTokens, req.signal)) {
              if ("delta" in chunk && chunk.delta) {
                send({
                  id,
                  object: "chat.completion.chunk",
                  created,
                  model: modelOut,
                  choices: [{ index: 0, delta: { content: chunk.delta }, finish_reason: null }],
                });
              } else if ("usage" in chunk) {
                usage = { prompt_tokens: chunk.usage.input, completion_tokens: chunk.usage.output };
              }
            }
            send({
              id,
              object: "chat.completion.chunk",
              created,
              model: modelOut,
              choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
              usage: { prompt_tokens: usage.prompt_tokens, completion_tokens: usage.completion_tokens, total_tokens: usage.prompt_tokens + usage.completion_tokens },
            });
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          } catch (err) {
            const msg = redactSecrets((err as Error)?.message ?? "upstream error", server.HF_TOKEN, server.AI_GATEWAY_API_KEY).slice(0, 300);
            send({
              id,
              object: "chat.completion.chunk",
              created,
              model: modelOut,
              choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
              error: { message: msg, type: "api_error", code: "upstream_error" },
            });
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
            await refund(db, rules).catch(() => undefined);
          }
        },
      });
      return new Response(readable, {
        status: 200,
        headers: {
          ...NO_STORE,
          "Content-Type": "text/event-stream; charset=utf-8",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        },
      });
    }

    let content = "";
    let usage = { prompt_tokens: 0, completion_tokens: 0 };
    for await (const chunk of runProvider(resolved, messages, env, server, ai, maxTokens, req.signal)) {
      if ("delta" in chunk) content += chunk.delta;
      else if ("usage" in chunk) usage = { prompt_tokens: chunk.usage.input, completion_tokens: chunk.usage.output };
    }
    return Response.json(
      {
        id,
        object: "chat.completion",
        created,
        model: modelOut,
        choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop", logprobs: null }],
        usage: { prompt_tokens: usage.prompt_tokens, completion_tokens: usage.completion_tokens, total_tokens: usage.prompt_tokens + usage.completion_tokens },
      },
      { headers: { ...NO_STORE } }
    );
  } catch (err) {
    await refund(db, rules).catch(() => undefined);
    const status = Number((err as { status?: number }).status) || 502;
    const code = String((err as { code?: string }).code ?? "upstream_error");
    const msg = redactSecrets((err as Error)?.message ?? "upstream error", server.HF_TOKEN, server.AI_GATEWAY_API_KEY).slice(0, 300);
    return openAiError(status >= 400 && status < 600 ? status : 502, msg, { code, type: status === 503 ? "server_error" : "api_error" });
  }
}
