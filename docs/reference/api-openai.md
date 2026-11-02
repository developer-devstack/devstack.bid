# API reference: OpenAI-compatible chat

Endpoints for clients that speak the OpenAI Chat Completions protocol. Auth uses the same Bearer MCP keys as `/mcp` (mint at [`/settings/mcp`](https://devstack.bid/settings/mcp)). Completions require `chat:write`; listing models accepts `chat:read` or `chat:write`. Responses use OpenAI error shapes `{ error: { message, type, param, code } }`. Same daily User Chat quota and per-key rate limit as the site chat.

Code: [`src/lib/openai-compat/`](../../src/lib/openai-compat/), routes under [`src/app/api/v1/`](../../src/app/api/v1/).

## `GET /api/v1/models`

```bash
curl -s https://devstack.bid/api/v1/models \
  -H "Authorization: Bearer $KEY"
```

Returns `{ object: "list", data: [{ id, object: "model", created, owned_by, available }] }`.

Aliases always listed: `general`, `thai`, `code`, `strong`. Also the configured Workers AI / Hugging Face ids and allowlisted Vercel AI Gateway ids (`openai/gpt-5-mini`, …). `available` is false when that provider secret is missing on the server.

## `POST /api/v1/chat/completions`

### Request

- Header `Authorization: Bearer nvx_live_…` (required, scope `chat:write`)
- Header `Content-Type: application/json`
- Body ≤ 64 KB

```json
{
  "model": "general",
  "messages": [
    { "role": "system", "content": "You are helpful." },
    { "role": "user", "content": "Say hi in one short sentence." }
  ],
  "stream": false,
  "max_tokens": 256
}
```

| Field | Notes |
|---|---|
| `model` | `general` / `thai` / `code` / `strong`, or exact Workers AI / HF / gateway id from `/api/v1/models`. Default `general`. |
| `messages` | OpenAI roles `system` \| `user` \| `assistant`. `content` string or array of `{ type: "text", text }`. Max 40 messages; content capped like User Chat. |
| `stream` | `true` → SSE (`text/event-stream`) of `chat.completion.chunk`, ending with `data: [DONE]`. |
| `max_tokens` / `max_completion_tokens` | Capped by server `WAI_MAX_TOKENS`. |

### Non-stream response

```json
{
  "id": "chatcmpl_…",
  "object": "chat.completion",
  "created": 1730000000,
  "model": "general",
  "choices": [{ "index": 0, "message": { "role": "assistant", "content": "…" }, "finish_reason": "stop", "logprobs": null }],
  "usage": { "prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0 }
}
```

### Stream response

SSE chunks with `object: "chat.completion.chunk"`; first delta may include `role: "assistant"`, then `content` deltas, then `finish_reason: "stop"` and optional `usage`, then `data: [DONE]`.

```bash
# non-stream
curl -s https://devstack.bid/api/v1/chat/completions \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"general","messages":[{"role":"user","content":"ping"}]}'

# stream
curl -sN https://devstack.bid/api/v1/chat/completions \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"general","stream":true,"messages":[{"role":"user","content":"ping"}]}'
```

### Errors

| HTTP | `error.type` / `code` (typical) |
|---|---|
| 400 | `invalid_request_error` / `invalid_request` or `model_not_found` |
| 401 | `authentication_error` / `invalid_api_key` |
| 403 | `permission_error` / `missing_scope` |
| 429 | `rate_limit_error` / `rate_limit_exceeded` (+ `Retry-After`) |
| 503 | `server_error` / `unavailable` |

### Providers (same as `/chat`)

| Alias | Provider |
|---|---|
| `general` | Workers AI (`WAI_MODEL`) |
| `thai` | Workers AI (`WAI_THAI_MODEL`) |
| `code` | Workers AI (`WAI_CODE_MODEL`) |
| `strong` | Hugging Face (`HF_MODEL`, needs `HF_TOKEN`) |
| gateway ids | Vercel AI Gateway (needs `AI_GATEWAY_API_KEY`) |

No new secrets are required for this API beyond what User Chat already uses.
