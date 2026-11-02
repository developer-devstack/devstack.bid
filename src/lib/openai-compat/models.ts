import "server-only";
import { GATEWAY_MODELS, isGatewayModel } from "@/lib/ai/gateway-models";
import type { ChatEnv } from "@/lib/chat/config";
import type { ServerEnv } from "@/lib/server/env";

export type CompatProvider = { kind: "wai" | "hf" | "gateway"; model: string; id: string };

/** Public model ids clients may pass to /api/v1/chat/completions and /api/v1/models. */
export function listCompatModels(env: ChatEnv, server: ServerEnv): Array<{
  id: string;
  object: "model";
  created: number;
  owned_by: string;
  available: boolean;
}> {
  const created = 1_720_000_000;
  const rows: Array<{ id: string; owned_by: string; available: boolean }> = [
    { id: "general", owned_by: "devstack", available: true },
    { id: "thai", owned_by: "devstack", available: true },
    { id: "code", owned_by: "devstack", available: true },
    { id: "strong", owned_by: "huggingface", available: Boolean(server.HF_TOKEN) },
    { id: env.WAI_MODEL, owned_by: "workers-ai", available: true },
    { id: env.WAI_THAI_MODEL, owned_by: "workers-ai", available: true },
    { id: env.WAI_CODE_MODEL, owned_by: "workers-ai", available: true },
    { id: server.HF_MODEL, owned_by: "huggingface", available: Boolean(server.HF_TOKEN) },
    ...GATEWAY_MODELS.map((m) => ({
      id: m.id,
      owned_by: "vercel-ai-gateway",
      available: Boolean(server.AI_GATEWAY_API_KEY),
    })),
  ];
  const seen = new Set<string>();
  return rows
    .filter((r) => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    })
    .map((r) => ({ id: r.id, object: "model" as const, created, owned_by: r.owned_by, available: r.available }));
}

/**
 * Map an OpenAI `model` string to the same providers User Chat uses.
 * Aliases: general|thai|code|strong, or exact Workers AI / HF / Gateway ids.
 */
export function resolveCompatModel(model: string | undefined, env: ChatEnv, server: ServerEnv): CompatProvider | { error: string; param: string } {
  const raw = (model ?? "general").trim();
  if (!raw) return { error: "model is required", param: "model" };

  if (raw === "general" || raw === "devstack/general") return { kind: "wai", model: env.WAI_MODEL, id: "general" };
  if (raw === "thai" || raw === "devstack/thai") return { kind: "wai", model: env.WAI_THAI_MODEL, id: "thai" };
  if (raw === "code" || raw === "devstack/code") return { kind: "wai", model: env.WAI_CODE_MODEL, id: "code" };
  if (raw === "strong" || raw === "devstack/strong") {
    if (!server.HF_TOKEN) return { error: "strong model is not configured on this server", param: "model" };
    return { kind: "hf", model: server.HF_MODEL, id: "strong" };
  }

  if (isGatewayModel(raw)) {
    if (!server.AI_GATEWAY_API_KEY) return { error: "Vercel AI Gateway is not configured on this server", param: "model" };
    return { kind: "gateway", model: raw, id: raw };
  }

  if (raw === env.WAI_MODEL || raw === env.WAI_THAI_MODEL || raw === env.WAI_CODE_MODEL) {
    return { kind: "wai", model: raw, id: raw };
  }
  if (raw === server.HF_MODEL) {
    if (!server.HF_TOKEN) return { error: "Hugging Face is not configured on this server", param: "model" };
    return { kind: "hf", model: raw, id: raw };
  }

  return {
    error: `Unknown model '${raw}'. Use GET /api/v1/models for the allowlist (general, thai, code, strong, or a gateway id).`,
    param: "model",
  };
}
