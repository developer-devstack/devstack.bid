import { useState } from 'react';
import { useDevstack, useRuntime } from '@/context/hooks';
import { translate, useLang, type Lang } from '@/i18n';

type Tab = 'grid' | 'schema' | 'vector' | 'sql';

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function Grid({ rows, lang }: { rows: Record<string, unknown>[]; lang: Lang }) {
  if (!rows.length) return <p className="p-3 text-xs text-devstack-muted">{translate(lang, 'inspector.noRows')}</p>;
  const cols = Object.keys(rows[0] ?? {});
  return (
    <table className="w-full border-collapse text-left text-[11px]" data-testid="data-grid">
      <thead className="sticky top-0 bg-devstack-surface-alt">
        <tr className="border-b border-devstack-border text-devstack-muted">
          {cols.map((k) => (
            <th key={k} className="px-2 py-1 font-mono font-medium">
              {k}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i} className="border-b border-devstack-border/40 hover:bg-devstack-secondary/30">
            {cols.map((c) => (
              <td key={c} className="max-w-[280px] truncate px-2 py-1 font-mono text-slate-300">
                {formatCell(row[c])}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function DataInspector({ mobile = false }: { mobile?: boolean }) {
  const { t, lang } = useLang();
  const rt = useRuntime();
  const open = useDevstack((s) => s.dataInspectorOpen);
  const tables = useDevstack((s) => s.tables);
  const rowCounts = useDevstack((s) => s.rowCounts);
  const selected = useDevstack((s) => s.selectedTable);
  const tableData = useDevstack((s) => s.tableData);
  const schema = useDevstack((s) => s.schema);
  const relations = useDevstack((s) => s.relations);
  const vectorResults = useDevstack((s) => s.vectorResults);
  const sqlResult = useDevstack((s) => s.sqlResult);
  const [tab, setTab] = useState<Tab>('grid');
  const [query, setQuery] = useState('');
  const [sql, setSql] = useState('SELECT * FROM todos ORDER BY id;');

  if (!open && !mobile) {
    return (
      <button
        type="button"
        onClick={() => rt.store.setState({ dataInspectorOpen: true })}
        className="panel min-h-10 px-4 py-2 text-left text-sm text-devstack-muted hover:text-devstack-accent"
      >
        ▲ {t('inspector.expand')}
      </button>
    );
  }

  const tabLabel = (key: Tab) =>
    key === 'grid'
      ? t('inspector.tab.grid')
      : key === 'schema'
        ? t('inspector.tab.schema')
        : key === 'vector'
          ? t('inspector.tab.vector')
          : t('inspector.tab.sql');

  return (
    <section
      className={`panel flex shrink-0 flex-col overflow-hidden ${mobile ? 'h-full min-h-0' : 'h-[300px]'}`}
      data-testid="data-inspector"
    >
      <header className={`panel-header flex px-4 py-2 ${mobile ? 'flex-col items-stretch gap-2' : 'items-center justify-between'}`}>
        <div className={`flex ${mobile ? 'items-center justify-between' : 'items-baseline gap-3'}`}>
          <h2 className="font-display text-sm font-semibold tracking-display">{t('inspector.title')}</h2>
          <p className={`text-[12px] text-devstack-muted ${mobile ? '' : ''}`}>{t('inspector.subtitle')}</p>
        </div>
        <div className={`flex items-center gap-1 ${mobile ? 'overflow-x-auto' : ''}`}>
          {(['grid', 'schema', 'vector', 'sql'] as const).map((key) => (
            <button
              key={key}
              type="button"
              data-testid={`inspector-tab-${key}`}
              onClick={() => setTab(key)}
              className={`min-h-9 shrink-0 rounded px-3 py-1.5 text-xs ${
                tab === key ? 'bg-devstack-secondary text-devstack-accent' : 'text-devstack-muted hover:text-white'
              }`}
            >
              {tabLabel(key)}
            </button>
          ))}
          {!mobile ? (
            <button
              type="button"
              onClick={() => rt.store.setState({ dataInspectorOpen: false })}
              className="ml-2 min-h-9 text-xs text-devstack-muted hover:text-white"
            >
              {t('inspector.collapse')} ▼
            </button>
          ) : null}
        </div>
      </header>
      <div className={`flex min-h-0 flex-1 ${mobile ? 'flex-col' : ''}`}>
        <ul className={`shrink-0 overflow-y-auto border-devstack-border py-1 ${mobile ? 'flex max-h-28 w-full gap-1 overflow-x-auto border-b px-2' : 'w-48 border-r'}`} data-testid="table-list">
          {tables.map((t) => (
            <li key={t}>
              <button
                type="button"
                data-table={t}
                onClick={() => {
                  setTab('grid');
                  void rt.selectTable(t);
                }}
                className={`flex items-center justify-between text-left font-mono ${
                  mobile
                    ? 'min-h-10 shrink-0 rounded-md border border-devstack-border px-3 py-2 text-xs'
                    : 'w-full px-3 py-1 text-[11px]'
                } ${
                  t === selected ? 'bg-devstack-secondary text-devstack-accent' : 'text-devstack-muted hover:text-white'
                }`}
              >
                <span className="truncate">{t}</span>
                <span className="ml-2 text-[10px] opacity-70">{rowCounts[t] ?? 0}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="min-w-0 flex-1 overflow-auto">
          {tab === 'grid' && <Grid rows={tableData} lang={lang} />}

          {tab === 'schema' && (
            <div className="space-y-3 p-3" data-testid="schema-topology">
              <div className="flex flex-wrap gap-3">
                {Object.entries(schema).map(([table, cols]) => (
                  <div key={table} className="min-w-[220px] rounded border border-devstack-border bg-black/40">
                    <p className="border-b border-devstack-border px-2 py-1 font-mono text-[11px] text-devstack-accent">
                      {table}
                    </p>
                    <ul className="px-2 py-1">
                      {cols.map((c) => (
                        <li key={c.column} className="flex justify-between gap-3 font-mono text-[10px]">
                          <span className={c.primaryKey ? 'text-white' : 'text-slate-300'}>
                            {c.primaryKey ? 'PK ' : ''}
                            {c.column}
                            {c.nullable ? '?' : ''}
                          </span>
                          <span className="text-devstack-muted">{c.type}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
              {relations.length > 0 && (
                <ul className="font-mono text-[11px] text-devstack-muted">
                  {relations.map((r, i) => (
                    <li key={i}>
                      {r.from}.{r.fromColumns.join(',')} <span className="text-devstack-accent">→</span> {r.to}.
                      {r.toColumns.join(',')}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {tab === 'vector' && (
            <div className="space-y-2 p-3">
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void rt.runVectorSearch(query);
                }}
              >
                <input
                  data-testid="vector-query"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('inspector.vectorPlaceholder')}
                  className="flex-1 rounded border border-devstack-border bg-black px-2 py-1 text-xs text-white outline-none focus:border-devstack-accent"
                />
                <button type="submit" data-testid="vector-search" className="btn-ai px-3 py-1 text-xs">
                  Search (cosine &lt;=&gt;)
                </button>
              </form>
              {vectorResults.length === 0 ? (
                <p className="text-xs text-devstack-muted">{t('inspector.vectorHelp')}</p>
              ) : (
                <ul className="space-y-1" data-testid="vector-results">
                  {vectorResults.map((r) => (
                    <li key={r.id} className="grid grid-cols-[1fr_140px_64px] items-center gap-2 font-mono text-[11px]">
                      <span className="truncate" title={r.content}>
                        <span className="text-devstack-muted">[{r.source}]</span> {r.label}
                      </span>
                      <span className="h-1.5 overflow-hidden rounded bg-devstack-secondary">
                        <span
                          className="block h-full bg-devstack-accent"
                          style={{ width: `${Math.max(2, (1 - Math.min(r.distance, 1)) * 100)}%` }}
                        />
                      </span>
                      <span className="text-right text-devstack-accent" data-testid="vector-distance">
                        {r.distance.toFixed(4)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {tab === 'sql' && (
            <div className="flex h-full flex-col gap-2 p-3">
              <div className="flex gap-2">
                <textarea
                  value={sql}
                  onChange={(e) => setSql(e.target.value)}
                  rows={2}
                  className="flex-1 resize-none rounded border border-devstack-border bg-black p-2 font-mono text-[11px] text-white outline-none focus:border-devstack-accent"
                />
                <button type="button" onClick={() => void rt.runSql(sql)} className="btn-ai px-3 text-xs">
                  Run SQL
                </button>
              </div>
              {sqlResult?.error && <p className="font-mono text-[11px] text-red-400">{sqlResult.error}</p>}
              {sqlResult && !sqlResult.error && (
                <div className="min-h-0 flex-1 overflow-auto">
                  {sqlResult.rows.length ? (
                    <Grid rows={sqlResult.rows} lang={lang} />
                  ) : (
                    <p className="text-xs text-devstack-muted">OK · {sqlResult.affected} rows affected</p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
