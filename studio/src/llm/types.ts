import type { ChatMessage } from '@/shared/apiTypes';

export type { ChatMessage };

export interface CompletionOptions {
  json?: boolean;
  maxTokens?: number;
  temperature?: number;
  /** Abort in-flight proxy fetch / mock work when the user hits Stop. */
  signal?: AbortSignal;
}

export interface LLMProvider {
  /** 'mock' for the deterministic offline provider, 'proxy' for the server-side proxy. */
  id: 'mock' | 'proxy';
  label: string;
  complete(messages: ChatMessage[], opts?: CompletionOptions): Promise<string>;
}

/** Inject an AbortSignal into every complete() call (used by the orchestrator Stop button). */
export function withAbortSignal(llm: LLMProvider, signal: AbortSignal): LLMProvider {
  return {
    id: llm.id,
    label: llm.label,
    complete(messages, opts = {}) {
      return llm.complete(messages, { ...opts, signal });
    },
  };
}
