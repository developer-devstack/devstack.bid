import { Suspense } from "react";
import type { Metadata } from "next";
import { TemplateDeploy } from "@/components/deploy/template-deploy";
import { SettingsNav } from "@/components/settings-nav";

export const metadata: Metadata = {
  title: "Deploy template",
  description: "Create a DevStack-hosted project from a Stack Template and deploy it to *.devstack.bid.",
  robots: { index: false },
};

export default function DeployTemplatePage() {
  return (
    <>
      <SettingsNav />
      <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:py-10">
        <Suspense fallback={<div className="mx-auto mt-10 max-w-lg animate-pulse rounded-xl border border-border bg-surface p-6 text-sm text-subtle">Loading…</div>}>
          <TemplateDeploy />
        </Suspense>
      </div>
    </>
  );
}
