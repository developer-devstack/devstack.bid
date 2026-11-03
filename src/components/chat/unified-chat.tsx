"use client";

import { Blocks, MessagesSquare, SquareTerminal } from "lucide-react";
import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AiSiteBuilder } from "@/components/aisite/ai-site-builder";
import { ChatApp } from "@/components/chat/chat-app";
import { useLang } from "@/components/prefs";
import { buttonClasses, cn } from "@/components/ui";
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
 * workspaces. Model picker stays inside Ask (ChatApp). Old /chat/build and /chat/dev URLs redirect here.
 */
export function UnifiedChat({ initialMode }: { initialMode?: string | null } = {}) {
  const { t } = useLang();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const raw = searchParams.get("mode") ?? initialMode ?? null;
  const parsed = useMemo(() => parseChatPageMode(raw), [raw]);

  const setPage = useCallback(
    (page: ChatPageMode) => {
      const href = chatPageHref(page);
      if (pathname === "/chat" && (searchParams.get("mode") ?? "") === (page === "ask" ? "" : page)) return;
      router.replace(href, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  return (
    <main className="mx-auto flex h-[calc(100dvh-3.5rem)] max-w-7xl flex-col px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:px-4">
      <div className="flex flex-wrap items-center gap-2 py-2">
        <h1 className="text-lg font-semibold tracking-tight">{t("chat.unifiedTitle")}</h1>
        <div
          className="ml-auto flex flex-wrap gap-1"
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
                className={cn(buttonClasses(selected ? "secondary" : "ghost", "sm"), "gap-1.5")}
                onClick={() => setPage(page)}
              >
                <meta.Icon className="size-3.5" aria-hidden />
                {t(meta.label)}
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
            className="h-full max-w-none"
          />
        )}
      </div>
    </main>
  );
}
