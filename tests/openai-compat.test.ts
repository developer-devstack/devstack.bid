import { beforeAll, describe, expect, it, vi } from "vitest";
import { sqliteD1 } from "./helpers/sqlite-d1";
import { chatEnv } from "@/lib/chat/config";
import { serverEnv } from "@/lib/server/env";
import { hashMcpKey } from "@/lib/mcp/auth";
import { resolveCompatModel, listCompatModels } from "@/lib/openai-compat/models";
import { normalizeMessages } from "@/lib/openai-compat/completions";
import { isKnownApiPath } from "@/lib/agent/api-paths";
import { openApiSpec } from "@/lib/agent/openapi";

vi.mock("server-only", () => ({}));

const db = sqliteD1();
process.env.CHAT_ENABLED = "true";
process.env.CHAT_COOKIE_SECRET = "test-cookie-secret-that-is-long-enough-0123456789";
process.env.HF_TOKEN = "hf_test_token_abcdefghijklmnop";
process.env.AI_GATEWAY_API_KEY = "gw_test_token_abcdefghijklmnop";

vi.mock("@/lib/chat/runtime", async (orig) => ({
  ...(await orig<object>()),
  chatRuntime: async () => ({ db, streams: null, waitUntil: () => undefined }),
}));

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: async () => ({
    env: {
      AI: {
        async run() {
          return {
            choices: [{ message: { content: "hello from workers ai" } }],
            usage: { prompt_tokens: 3, completion_tokens: 4 },
          };
        },
      },
    },
    ctx: { waitUntil: () => undefined },
  }),
}));

const KEY_WRITE = "nvx_live_" + "W".repeat(43);
const KEY_READ = "nvx_live_" + "R".repeat(43);
const KEY_CLI = "nvx_live_" + "C".repeat(43);

beforeAll(async () => {
  db.raw.exec(`INSERT INTO users (id, login, auth_provider, auth_subject) VALUES ('u1','alice','github','1');`);
  const add = async (id: string, key: string, scopes: string[]) =>
    db.raw.prepare("INSERT INTO api_clients (id, user_id, name, key_hash, scopes, rate_limit) VALUES (?, 'u1', ?, ?, ?, 120)").run(
      id,
      id,
      await hashMcpKey(key),
      JSON.stringify(scopes)
    );
  await add("kw", KEY_WRITE, ["chat:write", "chat:read"]);
  await add("kr", KEY_READ, ["chat:read"]);
  await add("kc", KEY_CLI, ["cli:setup"]);
});

describe("openai-compat models + messages", () => {
  it("resolves aliases and rejects unknown models", () => {
    const env = chatEnv({});
    const server = serverEnv({ HF_TOKEN: "hf_test_token_abcdefghijklmnop", AI_GATEWAY_API_KEY: "gw_test_token_abcdefghijklmnop" });
    expect(resolveCompatModel("general", env, server)).toMatchObject({ kind: "wai", id: "general" });
    expect(resolveCompatModel("thai", env, server)).toMatchObject({ kind: "wai", id: "thai" });
    expect(resolveCompatModel("code", env, server)).toMatchObject({ kind: "wai", id: "code" });
    expect(resolveCompatModel("strong", env, server)).toMatchObject({ kind: "hf", id: "strong" });
    expect(resolveCompatModel("openai/gpt-5-mini", env, server)).toMatchObject({ kind: "gateway" });
    expect(resolveCompatModel("nope", env, server)).toMatchObject({ param: "model" });
    const listed = listCompatModels(env, server);
    expect(listed.map((m) => m.id)).toEqual(expect.arrayContaining(["general", "thai", "code", "strong", "openai/gpt-5-mini"]));
  });

  it("normalizes OpenAI messages and rejects bad input", () => {
    expect(normalizeMessages([{ role: "user", content: "hi" }], 2000)).toEqual([{ role: "user", content: "hi" }]);
    expect(normalizeMessages([{ role: "user", content: [{ type: "text", text: "hi" }] }], 2000)).toEqual([{ role: "user", content: "hi" }]);
    expect(normalizeMessages([], 2000)).toMatchObject({ param: "messages" });
    expect(normalizeMessages([{ role: "tool", content: "x" }], 2000)).toMatchObject({ param: "messages" });
    expect(normalizeMessages([{ role: "assistant", content: "only" }], 2000)).toMatchObject({ param: "messages" });
  });
});

describe("POST /api/v1/chat/completions + GET /api/v1/models", () => {
  it("is on the API allowlist and OpenAPI", () => {
    expect(isKnownApiPath("/api/v1/chat/completions")).toBe(true);
    expect(isKnownApiPath("/api/v1/models")).toBe(true);
    const spec = openApiSpec();
    expect(spec.paths["/api/v1/chat/completions"]).toBeDefined();
    expect(spec.paths["/api/v1/models"]).toBeDefined();
    expect(spec.info.version).toBe("0.13.0-rc.6");
  });

  it("rejects missing key, CLI key, and read-only key on completions", async () => {
    const { handleChatCompletions, handleListModels } = await import("@/lib/openai-compat/completions");
    const body = JSON.stringify({ model: "general", messages: [{ role: "user", content: "ping" }] });
    const noAuth = await handleChatCompletions(
      new Request("https://devstack.bid/api/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json" }, body })
    );
    expect(noAuth.status).toBe(401);
    expect((await noAuth.json()).error.code).toBe("invalid_api_key");

    const cli = await handleChatCompletions(
      new Request("https://devstack.bid/api/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${KEY_CLI}` },
        body,
      })
    );
    expect(cli.status).toBe(403);

    const readOnly = await handleChatCompletions(
      new Request("https://devstack.bid/api/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${KEY_READ}` },
        body,
      })
    );
    expect(readOnly.status).toBe(403);

    const modelsOk = await handleListModels(new Request("https://devstack.bid/api/v1/models", { headers: { authorization: `Bearer ${KEY_READ}` } }));
    expect(modelsOk.status).toBe(200);
    const listed = await modelsOk.json();
    expect(listed.object).toBe("list");
    expect(listed.data.some((m: { id: string }) => m.id === "general")).toBe(true);
  });

  it("returns a non-stream chat.completion via Workers AI", async () => {
    const { handleChatCompletions } = await import("@/lib/openai-compat/completions");
    const res = await handleChatCompletions(
      new Request("https://devstack.bid/api/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${KEY_WRITE}` },
        body: JSON.stringify({ model: "general", messages: [{ role: "user", content: "ping" }], max_tokens: 64 }),
      })
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.object).toBe("chat.completion");
    expect(json.choices[0].message.content).toContain("hello from workers ai");
    expect(json.model).toBe("general");
  });

  it("streams OpenAI SSE chunks and [DONE]", async () => {
    const { handleChatCompletions } = await import("@/lib/openai-compat/completions");
    const res = await handleChatCompletions(
      new Request("https://devstack.bid/api/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${KEY_WRITE}` },
        body: JSON.stringify({ model: "general", stream: true, messages: [{ role: "user", content: "ping" }] }),
      })
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const text = await res.text();
    expect(text).toContain("chat.completion.chunk");
    expect(text).toContain("data: [DONE]");
    expect(text).toContain("hello from workers ai");
  });

  it("rejects unknown model with OpenAI error shape", async () => {
    const { handleChatCompletions } = await import("@/lib/openai-compat/completions");
    const res = await handleChatCompletions(
      new Request("https://devstack.bid/api/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${KEY_WRITE}` },
        body: JSON.stringify({ model: "totally-fake", messages: [{ role: "user", content: "x" }] }),
      })
    );
    expect(res.status).toBe(400);
    const err = await res.json();
    expect(err.error.type).toBe("invalid_request_error");
    expect(err.error.code).toBe("model_not_found");
  });
});
