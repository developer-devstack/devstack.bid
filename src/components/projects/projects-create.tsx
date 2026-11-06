"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { buttonClasses, Card } from "@/components/ui";
import { UploadZipPanel } from "./upload-zip-panel";
import { useLang } from "@/components/prefs";
import { ProjectHistoryPanel } from "./project-history-panel";

/** /projects — create hosted project, zip upload, and new-repo form (project list lives in the main nav sidebar). */
export function ProjectsCreate() {
  const { lang } = useLang();
  const th = lang === "th";
  const [name, setName] = useState("");
  const [priv, setPriv] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, private: priv }) });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(b.error ?? "Failed");
      window.location.href = `/projects/${b.project.id}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:py-10">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-6">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-fg">{th ? "โครงการต่างๆ" : "Projects"}</h1>
            <a href="/new" data-testid="projects-new" className={`${buttonClasses("primary", "md")} ml-auto max-sm:w-full`}>
              <Plus className="h-4 w-4" aria-hidden />
              {th ? "โครงการใหม่" : "New Project"}
            </a>
          </div>
          <p className="mt-1 text-sm text-subtle">
            {th
              ? "สร้าง repo DevStack บน GitHub นำเข้า repo ที่มีอยู่ หรืออัปโหลด zip — มีโควตารายวัน"
              : "Create a DevStack repository on GitHub, import an existing repo, or upload a zip (daily quota applies)."}{" "}
            <a href="/settings/cli" className="underline underline-offset-4 hover:text-fg">
              {th ? "หรือสร้างจาก Terminal / ดาวน์โหลด zip" : "Or start from Terminal / download a zip"}
            </a>
          </p>
          <p className="mt-2 text-sm text-subtle">
            {th ? "ประวัติโปรเจ็กต์อยู่ในเมนูด้านข้าง (ไอคอนเมนู)" : "Your project history is in the side menu (menu icon)."}
          </p>
          {error && <p role="alert" className="mt-4 rounded-lg border border-fg/40 px-3 py-2 text-sm text-fg">{error}</p>}
          <UploadZipPanel onDone={(id) => { location.href = `/projects/${encodeURIComponent(id)}`; }} />
          <Card className="mt-6 p-5">
            <form onSubmit={create} className="flex flex-wrap items-end gap-3">
              <label className="min-w-56 flex-1 text-sm font-medium text-fg">
                {th ? "ชื่อที่เก็บข้อมูลใหม่" : "New repository name"}
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  maxLength={100}
                  pattern="[A-Za-z0-9][A-Za-z0-9._-]*"
                  className="mt-1.5 w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-sm text-fg outline-none focus:border-fg"
                  placeholder={th ? "แอปของฉัน" : "my-app"}
                />
              </label>
              <label className="flex items-center gap-2 pb-2 text-sm text-fg">
                <input type="checkbox" checked={priv} onChange={(e) => setPriv(e.target.checked)} className="accent-current" />
                {th ? "ส่วนตัว" : "Private"}
              </label>
              <button disabled={busy || !name} className={buttonClasses("primary", "md")}>
                <Plus className="h-4 w-4" aria-hidden />
                {th ? "สร้าง repo" : "Create repo"}
              </button>
            </form>
          </Card>
        </div>
        <aside className="shrink-0 lg:w-[min(100%,20rem)]">
          <ProjectHistoryPanel className="lg:sticky lg:top-20" />
        </aside>
      </div>
    </div>
  );
}
