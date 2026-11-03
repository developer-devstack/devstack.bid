import { lazy, Suspense, useEffect, useState } from 'react';
import { AgentChat } from '@/components/AgentChat';
import { AssetPanel } from '@/components/AssetPanel';
import { EditorPanel } from '@/components/EditorPanel';
import { Header } from '@/components/Header';
import { MobileTabBar, type MobileTab } from '@/components/MobileTabBar';
import { PreviewTerminal } from '@/components/PreviewTerminal';
import { DevstackProvider } from '@/context/DevstackProvider';
import { useRuntime } from '@/context/hooks';
import { useIsMobile } from '@/hooks/useIsMobile';

const DataInspector = lazy(() => import('@/components/DataInspector'));
const ExportModal = lazy(() => import('@/components/ExportModal'));

function MobileWorkspace() {
  const rt = useRuntime();
  const [tab, setTab] = useState<MobileTab>('chat');

  useEffect(() => {
    // Free the screen: side panels default open for desktop, but bury them on phones.
    rt.store.setState({ assetPanelOpen: false, dataInspectorOpen: true });
  }, [rt]);

  useEffect(() => {
    if (tab === 'assets') rt.store.setState({ assetPanelOpen: true });
    if (tab === 'data') rt.store.setState({ dataInspectorOpen: true });
  }, [tab, rt]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-devstack-bg" data-testid="studio-mobile">
      <Header compact />
      <div className="divider-gradient" />
      <div className="flex min-h-0 flex-1 flex-col p-2">
        {tab === 'chat' ? (
          <div className="min-h-0 flex-1">
            <AgentChat fullWidth />
          </div>
        ) : null}
        {tab === 'preview' ? (
          <div className="min-h-0 flex-1">
            <PreviewTerminal mobile />
          </div>
        ) : null}
        {tab === 'code' ? (
          <div className="min-h-0 flex-1">
            <EditorPanel mobile />
          </div>
        ) : null}
        {tab === 'data' ? (
          <div className="min-h-0 flex-1 overflow-hidden">
            <Suspense fallback={null}>
              <DataInspector mobile />
            </Suspense>
          </div>
        ) : null}
        {tab === 'assets' ? (
          <div className="relative min-h-0 flex-1 overflow-hidden">
            <AssetPanel embedded />
          </div>
        ) : null}
      </div>
      <MobileTabBar tab={tab} onChange={setTab} />
      <Suspense fallback={null}>
        <ExportModal />
      </Suspense>
    </div>
  );
}

function DesktopWorkspace() {
  return (
    <div className="flex h-full min-h-0 flex-col bg-devstack-bg" data-testid="studio-desktop">
      <Header />
      <div className="divider-gradient" />
      <div className="flex min-h-0 flex-1 flex-col gap-2 p-2">
        <div className="relative flex min-h-0 flex-1 gap-2">
          <AgentChat />
          <main className="flex min-w-0 flex-1 flex-col gap-2">
            <EditorPanel />
            <PreviewTerminal />
          </main>
          <AssetPanel />
        </div>
        <Suspense fallback={null}>
          <DataInspector />
        </Suspense>
      </div>
      <Suspense fallback={null}>
        <ExportModal />
      </Suspense>
    </div>
  );
}

function Workspace() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileWorkspace /> : <DesktopWorkspace />;
}

export default function App() {
  return (
    <DevstackProvider>
      <Workspace />
    </DevstackProvider>
  );
}
