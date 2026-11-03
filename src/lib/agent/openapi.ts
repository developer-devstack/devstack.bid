import { MCP_SCOPES } from "@/lib/mcp/auth";
import { SITE_URL } from "@/lib/docs";

/** OpenAPI 3.1 description of DevStack's public HTTP APIs (site + MCP discovery). */
export function openApiSpec(site = SITE_URL) {
  const scopes = [...MCP_SCOPES];
  return {
    openapi: "3.1.0",
    info: {
      title: "DevStack (NVX Stack Builder) API",
      version: "0.13.0-rc.6",
      description:
        "Public HTTP APIs for DevStack at devstack.bid. Setup commands are returned as text only; the server does not execute user commands. OpenAI-compatible chat lives at /api/v1/chat/completions. MCP Streamable HTTP lives at /mcp (JSON-RPC). Create Bearer keys at /settings/mcp.",
    },
    servers: [{ url: site }],
    tags: [
      { name: "plan", description: "AI stack planner (offline, Hugging Face, or OpenAI)" },
      { name: "openai", description: "OpenAI-compatible chat completions (User Chat providers)" },
      { name: "mcp", description: "Model Context Protocol (Streamable HTTP JSON-RPC)" },
      { name: "meta", description: "Discovery and agent indexes" },
    ],
    paths: {
      "/api/plan": {
        get: {
          operationId: "getPlanCapabilities",
          summary: "Report which planner providers are configured on the server",
          tags: ["plan"],
          responses: {
            "200": {
              description: "Provider summary",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      serverKeyConfigured: { type: "boolean" },
                      provider: { type: "string", enum: ["huggingface", "openai", "offline"] },
                      model: { type: "string" },
                    },
                    required: ["serverKeyConfigured", "provider"],
                  },
                },
              },
            },
          },
        },
        post: {
          operationId: "createPlan",
          summary: "Generate a bilingual stack plan from a natural-language prompt",
          description: "Returns structured steps only. Optional header x-openai-key supplies a user OpenAI key for this request.",
          tags: ["plan"],
          security: [{ bearerMcp: ["plan:write"] }, {}],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    prompt: { type: "string", maxLength: 8000 },
                    lang: { type: "string", enum: ["en", "th"] },
                    mode: { type: "string", enum: ["auto", "fallback"] },
                  },
                  required: ["prompt"],
                },
              },
            },
          },
          responses: {
            "200": { description: "AgentPlan JSON" },
            "400": { $ref: "#/components/responses/ApiError" },
            "413": { $ref: "#/components/responses/ApiError" },
            "415": { $ref: "#/components/responses/ApiError" },
            "429": { $ref: "#/components/responses/ApiError" },
            "504": { $ref: "#/components/responses/ApiError" },
          },
        },
      },

      "/api/v1/chat/completions": {
        post: {
          operationId: "createChatCompletion",
          summary: "OpenAI-compatible chat completion",
          description:
            "Bearer MCP key with chat:write. Uses the same Workers AI / Hugging Face / Vercel AI Gateway providers as /chat. Supports stream=true (SSE). Same per-user daily chat quota as User Chat.",
          tags: ["openai"],
          security: [{ bearerMcp: ["chat:write"] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    model: { type: "string", description: "Alias general|thai|code|strong, a Workers AI id, HF id, or allowlisted gateway id" },
                    messages: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          role: { type: "string", enum: ["system", "user", "assistant"] },
                          content: { oneOf: [{ type: "string" }, { type: "array" }] },
                        },
                        required: ["role", "content"],
                      },
                    },
                    stream: { type: "boolean", default: false },
                    max_tokens: { type: "integer" },
                    max_completion_tokens: { type: "integer" },
                  },
                  required: ["messages"],
                },
              },
            },
          },
          responses: {
            "200": {
              description: "chat.completion JSON or text/event-stream of chat.completion.chunk",
              content: {
                "application/json": { schema: { type: "object" } },
                "text/event-stream": { schema: { type: "string" } },
              },
            },
            "400": { $ref: "#/components/responses/OpenAiError" },
            "401": { $ref: "#/components/responses/OpenAiError" },
            "403": { $ref: "#/components/responses/OpenAiError" },
            "429": { $ref: "#/components/responses/OpenAiError" },
            "503": { $ref: "#/components/responses/OpenAiError" },
          },
        },
      },
      "/api/v1/models": {
        get: {
          operationId: "listModels",
          summary: "List OpenAI-compatible models",
          description: "Bearer MCP key with chat:read or chat:write. Returns aliases and allowlisted provider ids.",
          tags: ["openai"],
          security: [{ bearerMcp: ["chat:read", "chat:write"] }],
          responses: {
            "200": {
              description: "OpenAI model list",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      object: { type: "string", enum: ["list"] },
                      data: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            id: { type: "string" },
                            object: { type: "string", enum: ["model"] },
                            created: { type: "integer" },
                            owned_by: { type: "string" },
                            available: { type: "boolean" },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            "401": { $ref: "#/components/responses/OpenAiError" },
            "403": { $ref: "#/components/responses/OpenAiError" },
          },
        },
      },
      "/mcp": {
        post: {
          operationId: "mcpJsonRpc",
          summary: "MCP Streamable HTTP JSON-RPC endpoint",
          tags: ["mcp"],
          security: [{ bearerMcp: scopes }],
          parameters: [
            { name: "Accept", in: "header", required: true, schema: { type: "string" }, description: "Must include application/json and text/event-stream" },
            { name: "MCP-Protocol-Version", in: "header", schema: { type: "string" } },
          ],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object" } } },
          },
          responses: {
            "200": { description: "JSON-RPC result or SSE stream" },
            "202": { description: "Notification accepted" },
            "400": { $ref: "#/components/responses/ApiError" },
            "403": { $ref: "#/components/responses/ApiError" },
            "406": { $ref: "#/components/responses/ApiError" },
            "415": { $ref: "#/components/responses/ApiError" },
          },
        },
      },
      "/llms.txt": {
        get: {
          operationId: "getLlmsIndex",
          summary: "Agent documentation index (llmstxt.org format)",
          tags: ["meta"],
          responses: {
            "200": { description: "Plain-text index of raw Markdown doc URLs", content: { "text/plain": { schema: { type: "string" } } } },
          },
        },
      },
      "/.well-known/mcp": {
        get: {
          operationId: "getMcpDiscovery",
          summary: "MCP server discovery document",
          tags: ["mcp", "meta"],
          responses: { "200": { description: "JSON discovery metadata" } },
        },
      },
    },
    components: {
      securitySchemes: {
        bearerMcp: {
          type: "oauth2",
          description: "Self-serve MCP Bearer keys from /settings/mcp (nvx_live_…)",
          flows: {
            clientCredentials: {
              tokenUrl: `${site}/api/mcp/keys`,
              scopes: Object.fromEntries(scopes.map((s) => [s, `MCP scope: ${s}`])),
            },
          },
        },
      },
      responses: {
        ApiError: {
          description: "Structured error",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ApiError" },
              example: { error: { code: "invalid_json", message: "Invalid JSON", hint: "Send Content-Type: application/json" } },
            },
          },
        },
        OpenAiError: {
          description: "OpenAI-shaped error",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/OpenAiError" },
              example: { error: { message: "Invalid or revoked API key.", type: "authentication_error", param: null, code: "invalid_api_key" } },
            },
          },
        },
      },
      schemas: {
        ApiError: {
          type: "object",
          properties: {
            error: {
              type: "object",
              properties: {
                code: { type: "string" },
                message: { type: "string" },
                hint: { type: "string" },
              },
              required: ["code", "message"],
            },
          },
          required: ["error"],
        },
        OpenAiError: {
          type: "object",
          properties: {
            error: {
              type: "object",
              properties: {
                message: { type: "string" },
                type: { type: "string" },
                param: { type: ["string", "null"] },
                code: { type: ["string", "null"] },
              },
              required: ["message", "type"],
            },
          },
          required: ["error"],
        },
      },
    },
  } as const;
}
