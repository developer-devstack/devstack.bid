import type { ChatMode } from "@/lib/chat/events";

/** Top-level workspace on the unified /chat page. */
export type ChatPageMode = "ask" | "build" | "dev";

export const CHAT_PAGE_MODES: readonly ChatPageMode[] = ["ask", "build", "dev"] as const;

const ASK_MODELS = new Set<ChatMode>(["general", "thai", "code", "strong", "image"]);

export interface ParsedChatPageMode {
  page: ChatPageMode;
  /** When the URL names a user-chat model (e.g. ?mode=code), preselect it inside Ask. */
  model?: ChatMode;
}

/**
 * Map ?mode= (and legacy path aliases) to the unified chat workspace.
 * Unknown / empty values fall back to Ask.
 */
export function parseChatPageMode(raw: string | null | undefined): ParsedChatPageMode {
  const v = (raw ?? "").trim().toLowerCase();
  if (!v || v === "ask" || v === "chat" || v === "user") return { page: "ask" };
  if (v === "build" || v === "aisite" || v === "site" || v === "ai-build") return { page: "build" };
  if (v === "dev" || v === "agent" || v === "orchestrator") return { page: "dev" };
  if (ASK_MODELS.has(v as ChatMode)) return { page: "ask", model: v as ChatMode };
  return { page: "ask" };
}

/** Canonical query for a workspace (and optional Ask model). */
export function chatPageHref(page: ChatPageMode, model?: ChatMode): string {
  if (page === "ask" && model && ASK_MODELS.has(model)) return `/chat?mode=${model}`;
  if (page === "ask") return "/chat";
  return `/chat?mode=${page}`;
}
