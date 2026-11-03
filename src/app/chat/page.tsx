import { Suspense } from "react";
import type { Metadata } from "next";
import { UnifiedChat } from "@/components/chat/unified-chat";

export const metadata: Metadata = {
  title: "Chat — ask, build a site, or use Dev agents",
  description:
    "One DevStack chat: free Thai/English Q&A and images, Build with AI for live site previews, and Dev Chat with a sandbox agent. Switch modes on one page.",
};

type ChatQuery = { mode?: string };

export default function ChatPage({ searchParams }: { searchParams: Promise<ChatQuery> }) {
  return (
    <Suspense fallback={<main className="mx-auto h-[calc(100dvh-3.5rem)] max-w-7xl px-2 sm:px-4" aria-busy="true" />}>
      <ChatFromQuery searchParams={searchParams} />
    </Suspense>
  );
}

async function ChatFromQuery({ searchParams }: { searchParams: Promise<ChatQuery> }) {
  const { mode } = await searchParams;
  return <UnifiedChat initialMode={mode ?? null} />;
}
