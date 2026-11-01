"use client";

import { useCallback, useEffect, useState } from "react";
import { Rocket } from "lucide-react";
import { Card, copyText } from "@/components/ui";
import { useLang } from "@/components/prefs";
import type { DeployProfile } from "@/lib/deploy/templates";
import { CreateTokenMenu } from "@/components/tokens/create-token-menu";
import { RememberToggle } from "@/components/tokens/remember-toggle";
import { LiveUrl, RetryButton, StatusPill, type DeploymentView } from "../deploy/deploy-status";

const input = "mt-1.5 w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-sm text-fg outline-none focus:border-fg";

/** Primary: Deploy to DevStack hosting (*.devstack.bid). Optional: customer's own Cloudflare. */
export function DirectDeployPanel({ projectId, profile }: { projectId: string; profile: DeployProfile }) {
  const { lang } = useLang();
  const th = lang === "th";
  const [items, setItems] = useState<DeploymentView[]>([]);
  const [once, setOnce] = useState({ token: "", accountId: "", remember: false });
  const load = useCallback(async () => {
    const r = await fetch(`/api/projects/${encodeURIComponent(projectId)}/deploy`, { cache: "no-store" });
    const b = await r.json().catch(() => ({}));
    return (b.deployments ?? []) as DeploymentView[];
  }, [projectId]);

  useEffect(() => {
    let on = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const list = await load().catch(() => []);
      if (!on) return;
      setItems(list);
      if (list.some((d) => d.status === "queued" || d.status === "uploading")) timer = setTimeout(tick, 3000);
    };
    void tick();
    return () => { on = false; clearTimeout(timer); };
  }, [load]);

  const refresh = () => { void load().then(setItems); setTimeout(() => void load().then(setItems), 3000); };
  const needsBuild = profile.path === "cf-build";
  const notDeployable = profile.path === "none";

  return (
    <Card className="mt-6 p-5">
      <div className="flex items-center gap-2">
        <Rocket className="h-5 w-5" aria-hidden />
        <h2 className="text-base font-semibold text-fg">{th ? "Deploy บนโฮสต์ติ้งของ DevStack" : "Deploy on DevStack hosting"}</h2>
      </div>
      <p className="mt-2 text-sm text-subtle">
        {th
          ? "ขึ้นที่ <slug>.devstack.bid โดยไม่ต้องเชื่อม Cloudflare ของคุณ (ค่าเริ่มต้น)"
          : "Publishes to <slug>.devstack.bid — no Cloudflare connection required (default)."}
      </p>
      {notDeployable ? (
        <p className="mt-3 text-sm text-subtle">{th ? "โปรเจกต์นี้ไม่ใช่เว็บแอปที่ deploy ได้บนแพลตฟอร์มนี้" : "This project is not a deployable web app on this platform."}</p>
      ) : (
        <div className="mt-3 space-y-3">
          <RetryButton projectId={projectId} refName={null} target="devstack" onStarted={() => refresh()} label={th ? "Deploy บน DevStack" : "Deploy on DevStack"} />
          {needsBuild && (
            <p className="text-xs text-subtle">{th ? "โปรเจกต์นี้ต้อง build — DevStack จะ build ให้ใน container แล้วขึ้นโฮสต์ติ้งของเรา (ต้องเป็น repo บน GitHub)" : "This project needs a build — DevStack builds it in a container and hosts it (GitHub repo required)."}</p>
          )}
          <details className="rounded-lg border border-border px-3 py-2 text-sm">
            <summary className="cursor-pointer text-fg">{th ? "ทางเลือก: Deploy เข้าบัญชี Cloudflare ของคุณ" : "Optional: deploy into your own Cloudflare account"}</summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="text-sm font-medium text-fg">API token<input type="password" autoComplete="off" spellCheck={false} value={once.token} onChange={(e) => setOnce({ ...once, token: e.target.value })} className={input} placeholder="••••" /></label>
              <label className="text-sm font-medium text-fg">Account ID<input value={once.accountId} onChange={(e) => setOnce({ ...once, accountId: e.target.value })} className={input} placeholder="32 hex characters" /></label>
              <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
                <RememberToggle checked={once.remember} onCheckedChange={(remember) => setOnce({ ...once, remember })} />
                <CreateTokenMenu primary="cloudflare" />
              </div>
              <div className="sm:col-span-2">
                <RetryButton projectId={projectId} refName={null} once={once.token ? once : null} target="cloudflare" onStarted={(id) => { setOnce({ token: "", accountId: once.accountId, remember: false }); refresh(); void id; }} label={th ? "Deploy ไป Cloudflare ของฉัน" : "Deploy to my Cloudflare"} />
              </div>
            </div>
          </details>
        </div>
      )}
      <ol className="mt-4 space-y-3 border-l border-border pl-4">
        {items.map((d) => (
          <li key={d.id} className="relative">
            <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border border-fg bg-bg" aria-hidden />
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <StatusPill status={d.status} />
              <span className="font-mono text-xs text-subtle">{d.ref} · {new Date(d.createdAt).toLocaleString()}</span>
              <a href={`/deployments/${encodeURIComponent(d.id)}`} className="text-xs text-subtle underline underline-offset-4 hover:text-fg">{th ? "รายละเอียด / logs" : "Details / logs"}</a>
              {d.fixAttempts > 0 && <span className="font-mono text-[11px] text-subtle">fix {d.fixAttempts}/{d.maxFixAttempts}</span>}
            </div>
            {d.url && d.status === "live" && <div className="mt-1"><LiveUrl url={d.url} /></div>}
            {d.status === "failed" && (
              <details className="mt-1 text-xs">
                <summary className="cursor-pointer text-fg">{d.errorCode}</summary>
                <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg border border-border p-2 font-mono text-[11px] text-subtle">{d.errorLog}</pre>
                <button type="button" onClick={() => void copyText(`Deploy ${d.id} failed. Read the deploy logs and fix it.`)} className="mt-1 text-subtle underline underline-offset-4 hover:text-fg">
                  {th ? "คัดลอกข้อความให้แชตช่วยแก้ (Dev Chat)" : "Copy a prompt for Dev Chat to fix it"}
                </button>
              </details>
            )}
          </li>
        ))}
        {items.length === 0 && <li className="text-sm text-subtle">{th ? "ยังไม่มีการ deploy" : "No deployments yet."}</li>}
      </ol>
    </Card>
  );
}
