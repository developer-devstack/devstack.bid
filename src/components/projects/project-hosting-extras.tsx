"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { Card, buttonClasses } from "@/components/ui";
import { useLang } from "@/components/prefs";

type DomainRow = {
  id: string;
  hostname: string;
  status: string;
  challenge?: { type: string; name: string; value: string };
  errorMessage?: string | null;
};

/** Custom domains + optional SSR Worker bindings (DevStack hosting). */
type Capabilities = { customDomains?: boolean; serverBindings?: boolean };

export function ProjectHostingExtras({ projectId }: { projectId: string }) {
  const { lang } = useLang();
  const th = lang === "th";
  const [cap, setCap] = useState<Capabilities | null>(null);
  const [domains, setDomains] = useState<DomainRow[]>([]);
  const [host, setHost] = useState("");
  const [ai, setAi] = useState(false);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const caps = (await fetch("/api/hosting/capabilities", { cache: "no-store" }).then((r) => r.json())) as Capabilities;
    setCap(caps);
    if (!caps.customDomains && !caps.serverBindings) return;
    const tasks: Promise<void>[] = [];
    if (caps.customDomains) {
      tasks.push(
        fetch(`/api/projects/${encodeURIComponent(projectId)}/domains`, { cache: "no-store" }).then(async (r) => {
          const d = await r.json();
          setDomains(d.domains ?? []);
        }),
      );
    }
    if (caps.serverBindings) {
      tasks.push(
        fetch(`/api/projects/${encodeURIComponent(projectId)}/server-bindings`, { cache: "no-store" }).then(async (r) => {
          const b = await r.json();
          setAi(!!b.bindings?.ai);
        }),
      );
    }
    await Promise.all(tasks);
  }, [projectId]);

  useEffect(() => {
    queueMicrotask(() => {
      void load();
    });
  }, [load]);

  const addDomain = async () => {
    setBusy(true);
    setMsg("");
    try {
      const r = await fetch(`/api/projects/${encodeURIComponent(projectId)}/domains`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hostname: host }),
      });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(b.error ?? "Failed");
      setHost("");
      await load();
      setMsg(th ? "เพิ่มโดเมนแล้ว — ตั้งค่า TXT แล้วกด Verify" : "Domain added — set the TXT record, then Verify.");
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (id: string) => {
    setBusy(true);
    setMsg("");
    try {
      const r = await fetch(`/api/projects/${encodeURIComponent(projectId)}/domains/${encodeURIComponent(id)}/verify`, { method: "POST" });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(b.error ?? "Failed");
      await load();
      setMsg(th ? "โดเมนพร้อมใช้งาน" : "Domain is active.");
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm(th ? "ลบโดเมนนี้?" : "Remove this domain?")) return;
    setBusy(true);
    try {
      await fetch(`/api/projects/${encodeURIComponent(projectId)}/domains/${encodeURIComponent(id)}`, { method: "DELETE" });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const saveBindings = async () => {
    setBusy(true);
    setMsg("");
    try {
      const r = await fetch(`/api/projects/${encodeURIComponent(projectId)}/server-bindings`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ai }),
      });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(b.error ?? "Failed");
      setMsg(th ? "บันทึก bindings แล้ว — redeploy production เพื่อให้มีผล" : "Bindings saved — redeploy production to apply.");
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (cap && !cap.customDomains && !cap.serverBindings) return null;

  return (
    <Card className="mt-6 space-y-6 p-5">
      {cap?.customDomains && (
      <HostingSection title={th ? "โดเมนของคุณ (beta)" : "Custom domain (beta)"}>
        <p className="text-sm text-subtle">
          {th
            ? "หลัง deploy production บน *.devstack.bid แล้ว เพิ่มโดเมนของคุณ (โซนต้องอยู่ในบัญชี Cloudflare เดียวกับ DevStack) ยืนยันด้วย TXT แล้วกด Verify"
            : "After a production deploy on *.devstack.bid, add your hostname (zone on the same Cloudflare account as DevStack). Prove control with TXT, then Verify."}
        </p>
        <DomainList domains={domains} th={th} onVerify={verify} onRemove={remove} busy={busy} />
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            type="text"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder="app.example.com"
            className="min-w-0 flex-1 rounded-lg border border-border bg-bg px-3 py-2 font-mono text-sm"
            disabled={busy}
          />
          <button type="button" className={buttonClasses("primary", "md")} disabled={busy || !host.trim()} onClick={() => void addDomain()}>
            {th ? "เพิ่มโดเมน" : "Add domain"}
          </button>
        </div>
      </HostingSection>
      )}
      {cap?.serverBindings && (
      <HostingSection title={th ? "Server bindings (SSR)" : "Server bindings (SSR)"}>
        <div className="flex items-start gap-2 text-sm">
          <input
            id="binding-ai"
            type="checkbox"
            checked={ai}
            onChange={(e) => setAi(e.target.checked)}
            disabled={busy}
            className="mt-1"
            aria-label={th ? "เปิด Workers AI binding บน Worker ฝั่งเซิร์ฟเวอร์" : "Enable Workers AI binding on the server Worker"}
          />
          <label htmlFor="binding-ai" className="cursor-pointer">
            <span className="font-medium text-fg">Workers AI</span>
            <span className="mt-0.5 block text-subtle">{th ? "เปิด binding AI บน Worker ฝั่งเซิร์ฟเวอร์ (OpenNext) — ใช้โควต้าแพลตฟอร์ม" : "Enable the AI binding on the server Worker (OpenNext) — uses platform quotas."}</span>
          </label>
        </div>
        <button type="button" className={buttonClasses("secondary", "md", "mt-3")} disabled={busy} onClick={() => void saveBindings()}>
          {th ? "บันทึก bindings" : "Save bindings"}
        </button>
      </HostingSection>
      )}
      {msg && <p className="text-sm text-subtle" role="status">{msg}</p>}
    </Card>
  );
}

function HostingSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-base font-semibold text-fg">{title}</h2>
      <div className="mt-2 space-y-2">{children}</div>
    </section>
  );
}

function DomainList({
  domains,
  th,
  onVerify,
  onRemove,
  busy,
}: {
  domains: DomainRow[];
  th: boolean;
  onVerify: (id: string) => void;
  onRemove: (id: string) => void;
  busy: boolean;
}) {
  if (!domains.length) return <p className="text-sm text-subtle">{th ? "ยังไม่มีโดเมนเพิ่ม" : "No custom domains yet."}</p>;
  return (
    <ul className="space-y-3 text-sm">
      {domains.map((d) => (
        <li key={d.id} className="rounded-lg border border-border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-fg">{d.hostname}</span>
            <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-subtle">{d.status}</span>
            {d.status === "pending" && (
              <button type="button" className={buttonClasses("primary", "sm")} disabled={busy} onClick={() => onVerify(d.id)}>
                {th ? "Verify" : "Verify"}
              </button>
            )}
            <button type="button" className={`${buttonClasses("ghost", "sm")} ml-auto`} disabled={busy} onClick={() => void onRemove(d.id)}>
              {th ? "ลบ" : "Remove"}
            </button>
          </div>
          {d.challenge && d.status === "pending" && (
            <p className="mt-2 font-mono text-[11px] text-subtle break-all">
              TXT {d.challenge.name} → {d.challenge.value}
            </p>
          )}
          {d.errorMessage && <p className="mt-1 text-xs text-fg">{d.errorMessage}</p>}
        </li>
      ))}
    </ul>
  );
}
