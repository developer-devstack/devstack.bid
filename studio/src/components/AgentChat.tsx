import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import type { AgentKind } from '@/broker/events';
import { TerminalSignature } from '@/brand/terminal-signature';
import { useDevstack, useRuntime } from '@/context/hooks';
import { useLang } from '@/i18n';
import type { MobileTab } from './MobileTabBar';

const AGENTS: { kind: AgentKind; label: string }[] = [
  { kind: 'orchestrator', label: 'Core' },
  { kind: 'code', label: 'Code' },
  { kind: 'db', label: 'DB' },
  { kind: 'design', label: 'Design' },
];

type PendingAttachment = { id: string; name: string; text: string };

const SUGGESTIONS = [
  { key: 'chat.suggest.todo' as const, prompt: 'build a todo app' },
  { key: 'chat.suggest.habit' as const, prompt: 'build a habit tracker with streaks' },
  { key: 'chat.suggest.notes' as const, prompt: 'build a notes app with tags' },
  { key: 'chat.suggest.landing' as const, prompt: 'build a landing page with a hero image' },
];

export function AgentChat({
  fullWidth = false,
  onOpenTab,
}: {
  fullWidth?: boolean;
  /** Mobile: jump to Preview / Code / Assets when an artifact card is opened. */
  onOpenTab?: (tab: MobileTab, path?: string) => void;
}) {
  const rt = useRuntime();
  const { t } = useLang();
  const messages = useDevstack((s) => s.messages);
  const thinking = useDevstack((s) => s.thinking);
  const thinkingAgent = useDevstack((s) => s.thinkingAgent);
  const activeAgents = useDevstack((s) => s.activeAgents);
  const llmLabel = useDevstack((s) => s.llmLabel);
  const backend = useDevstack((s) => s.backend);
  const previewUrl = useDevstack((s) => s.previewUrl);
  const assets = useDevstack((s) => s.assets);
  const activeFile = useDevstack((s) => s.activeFile);
  const files = useDevstack((s) => s.files);

  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [modelOpen, setModelOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isEmpty = messages.length <= 1;
  const lastAssistantId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m && m.role === 'assistant' && m.id !== 'welcome') return m.id;
    }
    return null;
  }, [messages]);
  const hasUserPrompt = messages.some((m) => m.role === 'user');

  // Auto-scroll (AI chatbot pattern): follow new messages + streaming state.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, thinking]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

  const importPending = useCallback(async () => {
    const pending = attachments;
    if (!pending.length) return;
    setAttachments([]);
    for (const a of pending) {
      await rt.importMarkdown(a.name, a.text);
    }
  }, [attachments, rt]);

  const submit = useCallback(
    async (text: string) => {
      const prompt = text.trim();
      if ((!prompt && !attachments.length) || thinking) return;
      setInput('');
      await importPending();
      if (prompt) void rt.sendPrompt(prompt);
    },
    [attachments.length, importPending, rt, thinking],
  );

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void submit(input);
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submit(input);
    }
  };

  const onFiles = async (e: ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (!list.length) return;
    const next: PendingAttachment[] = [];
    for (const file of list) {
      next.push({ id: `${file.name}-${file.size}-${file.lastModified}`, name: file.name, text: await file.text() });
    }
    setAttachments((prev) => [...prev, ...next]);
  };

  const openArtifact = (tab: MobileTab, path?: string) => {
    if (path) rt.setActiveFile(path);
    onOpenTab?.(tab, path);
  };

  const modelTitle = backend?.model
    ? `${backend.provider ?? 'AI'} · ${backend.model}`
    : llmLabel;

  return (
    <aside
      className={`panel flex h-full shrink-0 flex-col overflow-hidden ${fullWidth ? 'w-full' : 'w-[360px]'}`}
      data-testid="agent-chat"
    >
      <header className="panel-header flex items-center justify-between gap-2 px-3 py-2.5 sm:px-4 sm:py-3">
        <div className="min-w-0">
          <h2 className="font-display text-sm font-semibold tracking-display text-white">{t('chat.title')}</h2>
          <p className="truncate text-[12px] text-devstack-muted">{t('chat.subtitle')}</p>
        </div>
        <div className="relative shrink-0">
          <button
            type="button"
            data-testid="model-selector"
            aria-expanded={modelOpen}
            onClick={() => setModelOpen((o) => !o)}
            className="flex max-w-[10.5rem] items-center gap-1.5 rounded-full border border-devstack-border bg-black/50 px-2.5 py-1 text-left text-[11px] text-devstack-muted hover:border-devstack-accent hover:text-white"
            title={modelTitle}
          >
            <span
              data-testid="thinking-indicator"
              data-active={thinking}
              className={`h-2 w-2 shrink-0 rounded-full ${thinking ? 'neon-pulse bg-devstack-accent' : 'bg-devstack-secondary'}`}
              aria-hidden
            />
            <span className="truncate font-mono">{backend?.model ?? llmLabel}</span>
          </button>
          {modelOpen ? (
            <div
              role="listbox"
              data-testid="model-selector-menu"
              className="absolute right-0 z-20 mt-1 w-64 rounded-lg border border-devstack-border bg-devstack-surface p-3 shadow-lg"
            >
              <p className="text-[11px] font-medium uppercase tracking-wider text-devstack-muted">{t('chat.model')}</p>
              <p className="mt-1 break-all text-sm text-white">{modelTitle}</p>
              {backend?.note ? <p className="mt-2 text-[12px] leading-relaxed text-devstack-muted">{backend.note}</p> : null}
              {backend?.quota ? (
                <p className="mt-2 text-[12px] text-devstack-muted">
                  {t('chip.quota.short', {
                    calls: String(backend.quota.callsLeft),
                    images: String(backend.quota.imagesLeft),
                  })}
                </p>
              ) : null}
              <p className="mt-2 text-[11px] leading-relaxed text-devstack-muted">{t('chat.model.hint')}</p>
              <button
                type="button"
                className="mt-2 text-[12px] text-devstack-accent"
                onClick={() => setModelOpen(false)}
              >
                {t('common.close')}
              </button>
            </div>
          ) : null}
        </div>
      </header>

      {!fullWidth ? (
        <div className="flex gap-1 border-b border-devstack-border px-3 py-2">
          {AGENTS.map((a) => {
            const active = thinking && activeAgents.includes(a.kind);
            return (
              <span
                key={a.kind}
                className={`rounded border px-2 py-0.5 font-mono text-[10px] ${
                  active
                    ? 'neon-pulse border-devstack-accent text-devstack-accent'
                    : 'border-devstack-border text-devstack-muted'
                }`}
              >
                {a.label}
              </span>
            );
          })}
        </div>
      ) : null}

      <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-3 py-3 sm:px-4" data-testid="chat-messages">
        {isEmpty ? (
          <div className={`flex flex-col items-center px-1 pb-2 ${fullWidth ? 'gap-4 pt-4' : 'gap-2.5 pt-2'}`} data-testid="chat-empty">
            {fullWidth ? (
              <div className="mx-auto w-40 opacity-90" data-testid="studio-signature">
                <TerminalSignature />
              </div>
            ) : (
              <div className="mx-auto w-28 opacity-80" data-testid="studio-signature">
                <TerminalSignature />
              </div>
            )}
            <div className="text-center">
              <p className={`font-display font-semibold tracking-display text-white ${fullWidth ? 'text-lg sm:text-xl' : 'text-base'}`}>
                {t('chat.greeting')}
              </p>
              <p className={`mt-1 leading-relaxed text-devstack-muted ${fullWidth ? 'text-[13px]' : 'text-[12px]'}`}>{t('chat.welcome')}</p>
            </div>
            <div
              className={`grid w-full gap-2 ${fullWidth ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'}`}
              data-testid="suggested-actions"
            >
              {SUGGESTIONS.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  disabled={thinking}
                  data-testid={`suggest-${s.key}`}
                  onClick={() => void submit(s.prompt)}
                  className="rounded-xl border border-devstack-border/80 bg-black/30 px-3.5 py-3 text-left text-[13px] leading-relaxed text-devstack-muted transition hover:-translate-y-0.5 hover:border-devstack-accent/50 hover:bg-devstack-surface-alt hover:text-white"
                >
                  {t(s.key)}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {messages.map((m) => {
          if (m.id === 'welcome' && !isEmpty) return null;
          if (m.id === 'welcome' && isEmpty) return null; // greeting above replaces welcome bubble
          const isUser = m.role === 'user';
          const isSystem = m.role === 'system';
          return (
            <div
              key={m.id}
              data-role={m.role}
              data-testid={isUser ? 'message-user' : isSystem ? 'message-system' : 'message-assistant'}
              className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[92%] rounded-2xl px-3.5 py-2.5 text-[14px] leading-relaxed sm:max-w-[88%] ${
                  isUser
                    ? 'rounded-br-md bg-devstack-accent text-black'
                    : isSystem
                      ? 'rounded-bl-md border border-devstack-border bg-black/40 text-devstack-muted'
                      : 'rounded-bl-md border border-devstack-border bg-devstack-surface-alt text-white'
                }`}
              >
                {!isUser ? (
                  <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-devstack-muted">
                    {isSystem ? 'system' : 'assistant'}
                  </p>
                ) : null}
                <p className="whitespace-pre-wrap break-words">{m.content}</p>
                {!isUser && !isSystem && m.id === lastAssistantId && !thinking ? (
                  <div className="mt-2 flex flex-wrap gap-2 border-t border-devstack-border/60 pt-2">
                    <button
                      type="button"
                      data-testid="message-regenerate"
                      disabled={thinking || !hasUserPrompt}
                      onClick={() => void rt.regenerateLast()}
                      className="rounded-md border border-devstack-border px-2 py-1 text-[11px] text-devstack-muted hover:border-devstack-accent hover:text-white disabled:opacity-40"
                    >
                      {t('chat.regenerate')}
                    </button>
                    {previewUrl || Object.keys(files).length > 0 ? (
                      <button
                        type="button"
                        data-testid="artifact-preview"
                        onClick={() => openArtifact('preview')}
                        className="rounded-md border border-devstack-accent/40 bg-devstack-accent/10 px-2 py-1 text-[11px] text-devstack-accent hover:bg-devstack-accent/20"
                      >
                        {t('chat.artifact.preview')}
                      </button>
                    ) : null}
                    {activeFile ? (
                      <button
                        type="button"
                        data-testid="artifact-code"
                        onClick={() => openArtifact('code', activeFile)}
                        className="rounded-md border border-devstack-border px-2 py-1 text-[11px] text-devstack-muted hover:border-devstack-accent hover:text-white"
                      >
                        {t('chat.artifact.code')}
                      </button>
                    ) : null}
                    {assets.length ? (
                      <button
                        type="button"
                        data-testid="artifact-assets"
                        onClick={() => openArtifact('assets')}
                        className="rounded-md border border-devstack-border px-2 py-1 text-[11px] text-devstack-muted hover:border-devstack-accent hover:text-white"
                      >
                        {t('chat.artifact.assets')}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}

        {thinking ? (
          <div className="flex justify-start" data-testid="streaming-indicator">
            <div className="rounded-2xl rounded-bl-md border border-devstack-border bg-devstack-surface-alt px-3.5 py-2.5 text-[13px] text-devstack-muted">
              <span className="inline-flex items-center gap-2">
                <span className="neon-pulse inline-block h-2 w-2 rounded-full bg-devstack-accent" />
                {t('chat.streaming', { agent: thinkingAgent ?? 'orchestrator' })}
              </span>
            </div>
          </div>
        ) : null}
        <div ref={endRef} />
      </div>

      {/* Multimodal input bar */}
      <div className="safe-bottom border-t border-devstack-border bg-black/40 p-2.5 sm:p-3">
        {attachments.length ? (
          <div className="mb-2 flex flex-wrap gap-1.5" data-testid="attachment-preview">
            {attachments.map((a) => (
              <span
                key={a.id}
                className="inline-flex max-w-full items-center gap-1 rounded-lg border border-devstack-border bg-devstack-surface-alt px-2 py-1 text-[11px] text-devstack-muted"
              >
                <span className="truncate">{a.name}</span>
                <button
                  type="button"
                  aria-label={t('chat.attach.remove')}
                  className="text-devstack-muted hover:text-white"
                  onClick={() => setAttachments((prev) => prev.filter((x) => x.id !== a.id))}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : null}

        <input
          ref={fileRef}
          type="file"
          accept=".md,.markdown,text/markdown,text/plain"
          multiple
          className="hidden"
          data-testid="vault-input"
          onChange={(e) => void onFiles(e)}
        />

        <form
          onSubmit={onSubmit}
          data-testid="multimodal-input"
          className="rounded-2xl border border-devstack-border bg-devstack-surface-alt focus-within:border-devstack-accent focus-within:shadow-accent-glow"
        >
          <textarea
            ref={textareaRef}
            data-testid="prompt-input"
            value={input}
            rows={1}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
            placeholder={t('chat.placeholder')}
            className="max-h-40 min-h-[44px] w-full resize-none bg-transparent px-3.5 pb-1 pt-3 text-base leading-relaxed text-white outline-none placeholder:text-devstack-muted/60"
          />
          <div className="flex items-center gap-1.5 px-2 pb-2">
            <button
              type="button"
              data-testid="attach-button"
              onClick={() => fileRef.current?.click()}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-transparent text-lg text-devstack-muted hover:border-devstack-border hover:text-white"
              title={t('chat.attach')}
              aria-label={t('chat.attach')}
            >
              📎
            </button>
            <div className="flex-1" />
            {thinking ? (
              <button
                type="button"
                data-testid="prompt-stop"
                onClick={() => rt.stopGeneration()}
                className="flex h-10 min-w-10 items-center justify-center rounded-xl border border-devstack-danger/50 bg-devstack-danger/10 px-3 text-sm font-semibold text-devstack-danger"
              >
                {t('chat.stop')}
              </button>
            ) : (
              <button
                type="submit"
                data-testid="prompt-submit"
                disabled={!input.trim() && !attachments.length}
                className="btn-ai flex h-10 min-w-10 items-center justify-center rounded-xl px-4 text-sm font-semibold disabled:opacity-40"
                aria-label={t('chat.run')}
              >
                {t('chat.run')}
              </button>
            )}
          </div>
        </form>
      </div>
    </aside>
  );
}
