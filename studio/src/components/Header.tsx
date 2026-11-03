import { useState } from 'react';
import { Mascot } from '@/brand/mascot';
import { useDevstack, useRuntime } from '@/context/hooks';
import { useLang } from '@/i18n';

function Chip({ label, value, tone }: { label: string; value: string; tone: 'ok' | 'warn' | 'idle' | 'err' }) {
  const dot =
    tone === 'ok'
      ? 'bg-devstack-success'
      : tone === 'warn'
        ? 'bg-devstack-warning'
        : tone === 'err'
          ? 'bg-devstack-danger'
          : 'bg-devstack-muted';
  return (
    <span className="flex items-center gap-1.5 rounded-md border border-devstack-border bg-devstack-surface px-2 py-1 font-mono text-[10px] text-devstack-muted">
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      <span className="uppercase tracking-wider">{label}</span>
      <span className="max-w-[180px] truncate text-white/80">{value}</span>
    </span>
  );
}

const NAV = [
  { href: '/', key: 'nav.home' },
  { href: '/learn', key: 'nav.learn' },
  { href: '/chat', key: 'nav.chat' },
  { href: '/docs/user-guide/studio', key: 'nav.guide' },
] as const;

export function Header({ compact = false }: { compact?: boolean }) {
  const rt = useRuntime();
  const { t, lang, setLang } = useLang();
  const backend = useDevstack((s) => s.backend);
  const llmLabel = useDevstack((s) => s.llmLabel);
  const sandbox = useDevstack((s) => s.sandbox);
  const dbReady = useDevstack((s) => s.dbReady);
  const assetPanelOpen = useDevstack((s) => s.assetPanelOpen);
  const quota = backend?.quota;
  const [statusOpen, setStatusOpen] = useState(false);

  const ready =
    sandbox.phase === 'ready' && dbReady && Boolean(backend?.llm || backend?.image);
  const statusTone: 'ok' | 'idle' | 'err' =
    sandbox.phase === 'error' ? 'err' : ready || sandbox.phase === 'ready' ? 'ok' : 'idle';
  const statusLabel = sandbox.phase === 'error' ? t('chip.status.error') : ready ? t('chip.status.ready') : t('chip.status.starting');

  if (compact) {
    return (
      <header className="flex shrink-0 flex-col gap-2 border-b border-devstack-border bg-black/80 px-3 py-2.5 backdrop-blur">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <a href="/" className="flex shrink-0 items-center gap-2 rounded-md" aria-label="NVX Stack Builder home">
              <Mascot size={26} interactive />
            </a>
            <h1 className="font-display text-[15px] font-semibold tracking-display text-white">
              Studio
              <span className="ml-1.5 rounded-full border border-devstack-border px-1.5 py-0.5 align-middle font-mono text-[9px] font-medium uppercase tracking-wider text-devstack-muted">
                beta
              </span>
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => setLang(lang === 'en' ? 'th' : 'en')}
              aria-label={t('lang.label')}
              data-testid="lang-toggle"
              className="min-h-10 min-w-10 rounded-md border border-devstack-border px-2.5 text-xs text-devstack-muted hover:border-devstack-accent hover:text-white"
            >
              {t('lang.toggle')}
            </button>
            <button
              type="button"
              data-testid="deploy-export"
              onClick={() => rt.store.setState({ exportOpen: true })}
              className="min-h-10 rounded-full bg-devstack-cta px-3.5 text-sm font-semibold tracking-display text-black transition hover:bg-devstack-cta-hover"
            >
              {t('header.export.short')}
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2" data-testid="status-chips">
          <button
            type="button"
            onClick={() => setStatusOpen((v) => !v)}
            className="flex min-h-9 flex-1 items-center gap-2 rounded-md border border-devstack-border bg-devstack-surface px-2.5 py-1.5 text-left text-xs text-white/90"
            aria-expanded={statusOpen}
          >
            <span
              className={`h-2 w-2 rounded-full ${
                statusTone === 'ok'
                  ? 'bg-devstack-success'
                  : statusTone === 'err'
                    ? 'bg-devstack-danger'
                    : 'bg-devstack-muted'
              }`}
            />
            <span className="truncate">{statusLabel}</span>
            {quota ? (
              <span className="ml-auto shrink-0 text-[11px] text-devstack-muted">
                {t('chip.quota.short', { calls: String(quota.callsLeft), images: String(quota.imagesLeft) })}
              </span>
            ) : null}
          </button>
        </div>
        {statusOpen ? (
          <div className="flex flex-wrap gap-1.5 pb-0.5" data-testid="status-chips-detail">
            <Chip label="AI" value={llmLabel} tone={backend?.llm ? 'ok' : 'warn'} />
            <Chip label={t('chip.image')} value={backend?.imageModel ?? 'placeholder'} tone={backend?.image ? 'ok' : 'warn'} />
            <Chip
              label={t('chip.sandbox')}
              value={sandbox.phase}
              tone={sandbox.phase === 'ready' ? 'ok' : sandbox.phase === 'error' ? 'err' : 'idle'}
            />
            <Chip label={t('chip.db')} value={dbReady ? t('chip.db.ready') : t('chip.db.starting')} tone={dbReady ? 'ok' : 'idle'} />
          </div>
        ) : null}
      </header>
    );
  }

  return (
    <header className="flex shrink-0 items-center justify-between gap-4 border-b border-devstack-border bg-black/80 px-4 py-2.5 backdrop-blur">
      <div className="flex min-w-0 items-center gap-3">
        <a href="/" className="flex items-center gap-2 rounded-md font-semibold tracking-tight" aria-label="NVX Stack Builder home">
          <Mascot size={28} interactive />
          <span className="hidden text-[15px] text-white sm:inline">Stack Builder</span>
        </a>
        <span className="text-devstack-muted" aria-hidden>
          /
        </span>
        <h1 className="font-display text-[15px] font-semibold tracking-display text-white">
          Studio
          <span className="ml-2 rounded-full border border-devstack-border px-1.5 py-0.5 align-middle font-mono text-[9px] font-medium uppercase tracking-wider text-devstack-muted">
            beta
          </span>
        </h1>
        <nav aria-label="devstack.bid" className="ml-2 hidden items-center gap-1 xl:flex">
          {NAV.map((n) => (
            <a key={n.href} href={n.href} className="rounded-md px-2.5 py-1 text-[13px] text-devstack-muted hover:text-white">
              {t(n.key)}
            </a>
          ))}
        </nav>
      </div>
      <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2" data-testid="status-chips">
        <Chip label="LLM" value={llmLabel} tone={backend?.llm ? 'ok' : 'warn'} />
        <Chip label="Image" value={backend?.imageModel ?? 'placeholder'} tone={backend?.image ? 'ok' : 'warn'} />
        <Chip
          label="Sandbox"
          value={sandbox.phase}
          tone={sandbox.phase === 'ready' ? 'ok' : sandbox.phase === 'error' ? 'err' : 'idle'}
        />
        <Chip label="DB" value={dbReady ? 'PGlite + pgvector' : 'starting'} tone={dbReady ? 'ok' : 'idle'} />
        {quota ? (
          <span data-testid="quota-chip">
            <Chip label={t('chip.quota')} value={`${quota.callsLeft} LLM · ${quota.imagesLeft} img`} tone={quota.callsLeft > 0 ? 'ok' : 'warn'} />
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => setLang(lang === 'en' ? 'th' : 'en')}
          aria-label={t('lang.label')}
          data-testid="lang-toggle"
          className="rounded-md border border-devstack-border px-3 py-2 text-xs text-devstack-muted hover:border-devstack-accent hover:text-white"
        >
          {t('lang.toggle')}
        </button>
        <button
          type="button"
          onClick={() => rt.store.setState({ assetPanelOpen: !assetPanelOpen })}
          className="rounded-md border border-devstack-border px-3 py-2 text-xs text-devstack-muted hover:border-devstack-accent hover:text-white"
        >
          {t('header.assets')}
        </button>
        <button
          type="button"
          data-testid="deploy-export"
          onClick={() => rt.store.setState({ exportOpen: true })}
          className="rounded-full bg-devstack-cta px-4 py-2 text-sm font-semibold tracking-display text-black transition hover:bg-devstack-cta-hover"
        >
          {t('header.export')}
        </button>
      </div>
    </header>
  );
}
