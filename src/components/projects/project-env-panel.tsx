"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, buttonClasses } from "@/components/ui";
import { useLang } from "@/components/prefs";

type EnvRow = { key: string; environment: "preview" | "production"; isSecret: boolean; updatedAt: number };

export function ProjectEnvPanel({ projectId }: { projectId: string }) {
  const { lang } = useLang();
  const th = lang === "th";
  const [environment, setEnvironment] = useState<"preview" | "production">("production");
  const [rows, setRows] = useState<EnvRow[]>([]);
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch(`/api/projects/${encodeURIComponent(projectId)}/env?environment=${environment}`, { cache: "no-store" });
    const b = (await r.json()) as { variables?: EnvRow[] };
    setRows(b.variables ?? []);
  }, [projectId, environment]);

  useEffect(() => {
    queueMicrotask(() => {
      void load();
    });
  }, [load]);

  const save = async () => {
    setBusy(true);
    setMsg("");
    try {
      const r = await fetch(`/api/projects/${encodeURIComponent(projectId)}/env`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: key.trim().toUpperCase(), value, environment }),
      });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((b as { error?: string }).error ?? "Failed");
      setKey("");
      setValue("");
      await load();
      setMsg(th ? "บันทึกแล้ว — redeploy เพื่อให้ runtime ใช้ค่าใหม่" : "Saved — redeploy for runtime to pick up new values.");
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (envKey: string) => {
    if (!confirm(th ? `ลบ ${envKey}?` : `Delete ${envKey}?`)) return;
    setBusy(true);
    setMsg("");
    try {
      const r = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/env/${encodeURIComponent(envKey)}?environment=${environment}`,
        { method: "DELETE" },
      );
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        throw new Error((b as { error?: string }).error ?? "Failed");
      }
      await load();
      setMsg(th ? "ลบแล้ว — redeploy ถ้าต้องการเอาออกจาก Worker" : "Removed — redeploy to drop from the Worker.");
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mt-6 space-y-4 p-5">
      <div>
        <h2 className="text-base font-semibold text-fg">{th ? "ตัวแปรลับ (Environment)" : "Environment secrets"}</h2>
        <p className="mt-1 text-sm text-subtle">
          {th
            ? "ใส่ DATABASE_URL, AUTH_SECRET, GITHUB_ID, GITHUB_SECRET ฯลฯ สำหรับแอปของคุณ — ไม่ใช่ secret ของ DevStack ชื่อต้องเป็นตัวพิมพ์ใหญ่และขีดล่าง (เช่น AUTH_SECRET)"
            : "Set DATABASE_URL, AUTH_SECRET, GITHUB_ID, GITHUB_SECRET for your app — not DevStack platform secrets. Names must be UPPER_SNAKE_CASE."}
        </p>
      </div>
      <EnvEnvironmentSelect environment={environment} th={th} disabled={busy} onChange={setEnvironment} />
      <ul className="space-y-2 text-sm">
        {!rows.length && <li className="text-subtle">{th ? "ยังไม่มีตัวแปรใน environment นี้" : "No variables in this environment yet."}</li>}
        {rows.map((row) => (
          <li key={row.key} className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2 font-mono">
            <span className="text-fg">{row.key}</span>
            <span className="text-[11px] text-subtle">{th ? "ค่าถูกซ่อน" : "value hidden"}</span>
            <button type="button" className={`${buttonClasses("ghost", "sm")} ml-auto`} disabled={busy} onClick={() => void remove(row.key)}>
              {th ? "ลบ" : "Remove"}
            </button>
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
          <span className="text-subtle">{th ? "ชื่อตัวแปร" : "Variable name"}</span>
          <input
            type="text"
            value={key}
            onChange={(e) => setKey(e.target.value.toUpperCase())}
            placeholder="DATABASE_URL"
            className="rounded-lg border border-border bg-bg px-3 py-2 font-mono text-sm"
            disabled={busy}
            autoComplete="off"
          />
        </label>
        <label className="flex min-w-0 flex-[2] flex-col gap-1 text-sm">
          <span className="text-subtle">{th ? "ค่า (ไม่แสดงอีกครั้งหลังบันทึก)" : "Value (not shown again after save)"}</span>
          <input
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="rounded-lg border border-border bg-bg px-3 py-2 font-mono text-sm"
            disabled={busy}
            autoComplete="new-password"
          />
        </label>
        <button type="button" className={buttonClasses("primary", "md")} disabled={busy || !key.trim() || !value} onClick={() => void save()}>
          {th ? "บันทึก" : "Save"}
        </button>
      </div>
      {msg && (
        <p className="text-sm text-subtle" role="status">
          {msg}
        </p>
      )}
    </Card>
  );
}

function EnvEnvironmentSelect({
  environment,
  th,
  disabled,
  onChange,
}: {
  environment: "preview" | "production";
  th: boolean;
  disabled: boolean;
  onChange: (e: "preview" | "production") => void;
}) {
  return (
    <div className="flex flex-wrap gap-2 text-sm" role="group" aria-label={th ? "เลือก environment" : "Choose environment"}>
      {(["production", "preview"] as const).map((e) => (
        <button
          key={e}
          type="button"
          disabled={disabled}
          className={`rounded-full border px-3 py-1 ${environment === e ? "border-fg bg-fg text-bg" : "border-border text-subtle"}`}
          onClick={() => onChange(e)}
        >
          {e === "production" ? "Production" : "Preview"}
        </button>
      ))}
    </div>
  );
}