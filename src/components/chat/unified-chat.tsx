"use client";

import { Blocks, History, MessagesSquare, SquareTerminal } from "lucide-react";
import { useCallback, useMemo, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AiSiteBuilder } from "@/components/aisite/ai-site-builder";
import { ChatApp, type ChatHistoryApi } from "@/components/chat/chat-app";
import { useLang } from "@/components/prefs";
import { Button, buttonClasses, cn } from "@/components/ui";
import {
  CHAT_PAGE_MODES,
  chatPageHref,
  parseChatPageMode,
  type ChatPageMode,
} from "@/lib/chat/page-mode";
import type { DictKey } from "@/lib/i18n";

const MODE_META: Record<ChatPageMode, { label: DictKey; Icon: typeof MessagesSquare }> = {
  ask: { label: "chat.modeTab.ask", Icon: MessagesSquare },
  build: { label: "chat.modeTab.build", Icon: Blocks },
  dev: { label: "chat.modeTab.dev", Icon: SquareTerminal },
};

/**
 * One main chat page: Build-style chrome (title + secondary/ghost tabs) with Ask / Build / Dev
 * workspaces. History lives in this top bar (visible at 390px). Model picker stays inside Ask.
 */
export function UnifiedChat({ initialMode }: { initialMode?: string | null } = {}) {
  const { t } = useLang();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const historyApiRef = useRef<ChatHistoryApi | null>(null);
  const raw = searchParams.get("mode") ?? initialMode ?? null;
  const parsed = useMemo(() => parseChatPageMode(raw), [raw]);
  const chatModes = parsed.page === "ask" || parsed.page === "dev";

  const setPage = useCallback(
    (page: ChatPageMode) => {
      const href = chatPageHref(page);
      if (pathname === "/chat" && (searchParams.get("mode") ?? "") === (page === "ask" ? "" : page)) return;
      router.replace(href, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  const openHistory = useCallback(() => {
    historyApiRef.current?.open();
  }, []);

  return (
    <main className="mx-auto flex h-[calc(100dvh-3.5rem)] max-w-7xl flex-col px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:px-4">
      <div className="flex shrink-0 flex-nowrap items-center gap-1.5 overflow-x-auto py-2 sm:gap-2">
        <h1 className="shrink-0 text-base font-semibold tracking-tight sm:text-lg">{t("chat.unifiedTitle")}</h1>
        {chatModes && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="shrink-0 gap-1.5"
            onClick={openHistory}
            aria-label={t("chat.history")}
          >
            <History className="size-3.5" aria-hidden />
            <span className="text-[13px]">{t("chat.history")}</span>
          </Button>
        )}
        <div
          className="ml-auto flex shrink-0 flex-nowrap gap-1"
          role="tablist"
          aria-label={t("chat.modeTabs")}
        >
          {CHAT_PAGE_MODES.map((page) => {
            const meta = MODE_META[page];
            const selected = parsed.page === page;
            return (
              <button
                key={page}
                type="button"
                role="tab"
                aria-selected={selected}
                className={cn(buttonClasses(selected ? "secondary" : "ghost", "sm"), "gap-1.5 px-2 sm:gap-1.5 sm:px-3")}
                onClick={() => setPage(page)}
              >
                <meta.Icon className="size-3.5 shrink-0" aria-hidden />
                <span className="whitespace-nowrap">{t(meta.label)}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {parsed.page === "build" ? (
          <AiSiteBuilder embedded />
        ) : (
          <ChatApp
            key={parsed.page}
            channel={parsed.page === "dev" ? "dev" : "user"}
            initialMode={parsed.page === "ask" ? parsed.model : undefined}
            embedded
            historyApiRef={historyApiRef}
            className="h-full max-w-none"
          />
        )}
      </div>
    </main>
  );
}
