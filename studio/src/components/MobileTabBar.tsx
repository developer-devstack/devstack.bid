import { useLang, type StringKey } from '@/i18n';

export type MobileTab = 'chat' | 'preview' | 'code' | 'data' | 'assets';

const TABS: { id: MobileTab; labelKey: StringKey; icon: string }[] = [
  { id: 'chat', labelKey: 'mobile.tab.chat', icon: '◎' },
  { id: 'preview', labelKey: 'mobile.tab.preview', icon: '◉' },
  { id: 'code', labelKey: 'mobile.tab.code', icon: '</>' },
  { id: 'data', labelKey: 'mobile.tab.data', icon: '▦' },
  { id: 'assets', labelKey: 'mobile.tab.assets', icon: '▣' },
];

export function MobileTabBar({ tab, onChange }: { tab: MobileTab; onChange: (t: MobileTab) => void }) {
  const { t } = useLang();
  return (
    <nav
      aria-label={t('mobile.nav')}
      data-testid="mobile-tab-bar"
      className="safe-bottom flex shrink-0 border-t border-devstack-border bg-black/95 px-1 pt-1 backdrop-blur"
    >
      {TABS.map((item) => {
        const active = tab === item.id;
        return (
          <button
            key={item.id}
            type="button"
            data-testid={`mobile-tab-${item.id}`}
            aria-current={active ? 'page' : undefined}
            onClick={() => onChange(item.id)}
            className={`flex min-h-[52px] flex-1 flex-col items-center justify-center gap-0.5 rounded-md px-1 py-1 text-[11px] font-medium ${
              active ? 'text-devstack-accent' : 'text-devstack-muted'
            }`}
          >
            <span className="text-[15px] leading-none" aria-hidden>
              {item.icon}
            </span>
            <span className="max-w-full truncate">{t(item.labelKey)}</span>
          </button>
        );
      })}
    </nav>
  );
}
