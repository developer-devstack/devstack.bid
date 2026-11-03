import type { Terminal } from '@xterm/xterm';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useDevstack, useRuntime } from '@/context/hooks';
import { useLang } from '@/i18n';
import { XTerm } from './XTerm';

function OutputTerminal() {
  const rt = useRuntime();
  const attach = useCallback(
    (term: Terminal) => {
      term.write(rt.terminal.replay());
      return rt.terminal.subscribe((c) => term.write(c));
    },
    [rt],
  );
  return <XTerm attach={attach} testId="terminal-output" />;
}

export function PreviewTerminal({ mobile = false }: { mobile?: boolean }) {
  const { t } = useLang();
  const rt = useRuntime();
  const previewUrl = useDevstack((s) => s.previewUrl);
  const nonce = useDevstack((s) => s.previewNonce);
  const sandbox = useDevstack((s) => s.sandbox);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [reloads, setReloads] = useState(0);
  const [showLog, setShowLog] = useState(false);

  useEffect(() => {
    rt.setPreviewWindowGetter(() => iframeRef.current?.contentWindow ?? null);
  }, [rt]);

  const shellClass = mobile
    ? 'flex h-full min-h-0 flex-col gap-2'
    : 'grid h-[42%] min-h-[220px] grid-cols-2 gap-2';

  return (
    <div className={shellClass}>
      <section className={`panel flex min-h-0 flex-col overflow-hidden ${mobile ? 'flex-1' : ''}`} data-testid="preview-panel">
        <header className="panel-header flex items-center justify-between gap-2 px-3 py-2">
          <span className="text-xs text-devstack-muted">
            {t('preview.live')} ·{' '}
            <span data-testid="sandbox-phase" className={sandbox.phase === 'ready' ? 'text-devstack-accent' : ''}>
              {sandbox.phase}
            </span>
          </span>
          <div className="flex min-w-0 items-center gap-2">
            {previewUrl && (
              <>
                <span className="truncate font-mono text-[10px] text-devstack-muted" title={t('preview.static.hint')}>
                  {t('preview.static')}
                </span>
                <button
                  type="button"
                  onClick={() => setReloads((n) => n + 1)}
                  className="min-h-8 rounded border border-devstack-border px-2.5 py-1 text-xs text-devstack-muted hover:text-white"
                >
                  {t('preview.reload')}
                </button>
              </>
            )}
            {mobile ? (
              <button
                type="button"
                onClick={() => setShowLog((v) => !v)}
                className="min-h-8 rounded border border-devstack-border px-2.5 py-1 text-xs text-devstack-muted hover:text-white"
              >
                {t('preview.output')}
              </button>
            ) : null}
          </div>
        </header>
        <div className="min-h-0 flex-1 bg-black">
          {previewUrl ? (
            <iframe
              ref={iframeRef}
              key={`${nonce}-${reloads}`}
              data-testid="preview-iframe"
              title={t('preview.title')}
              src={previewUrl}
              sandbox="allow-scripts allow-forms allow-modals"
              referrerPolicy="no-referrer"
              className="h-full w-full border-0 bg-black"
            />
          ) : (
            <p className="p-4 font-mono text-xs text-devstack-muted">
              {sandbox.phase === 'error'
                ? `Sandbox unavailable: ${sandbox.message ?? 'unknown error'}`
                : `${t('preview.waiting')} (${sandbox.message ?? sandbox.phase})…`}
            </p>
          )}
        </div>
      </section>
      {!mobile || showLog ? (
        <section
          className={`panel flex min-h-0 flex-col overflow-hidden ${mobile ? 'h-[38%] min-h-[140px]' : ''}`}
          data-testid="terminal-panel"
        >
          <header className="panel-header flex items-center gap-1 px-2 py-1.5">
            <span className="rounded bg-devstack-secondary px-2 py-0.5 font-mono text-[11px] text-devstack-accent">
              {t('preview.output')}
            </span>
          </header>
          <div className="min-h-0 flex-1">
            <OutputTerminal />
          </div>
        </section>
      ) : null}
    </div>
  );
}
