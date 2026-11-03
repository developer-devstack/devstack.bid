"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Rocket } from "lucide-react";
import { KNOWN_TEMPLATE_IDS } from "@/data/template-ids";
import { getTemplate } from "@/data/templates";
import { profileById } from "@/lib/deploy/templates";
import { templateCanLiveDeploy, templateDeployName } from "@/lib/projects/template-deploy-name";
import { buttonClasses, Card, Spinner } from "@/components/ui";
import { useLang } from "@/components/prefs";
import { requestDeploy } from "@/components/deploy/deploy-status";

type Phase = "checking" | "creating" | "deploying" | "done" | "error";

/**
 * /deploy?template=<id> — create a DevStack-hosted project from the template
 * (R2/D1 only; never creates a GitHub repo), start Deploy when the template is
 * a web app, then send the user to the platform deploy page.
 */
export function TemplateDeploy() {
  const { lang } = useLang();
  const th = lang === "th";
  const params = useSearchParams();
  const raw = params.get("template") ?? "";
  const templateId = (KNOWN_TEMPLATE_IDS as readonly string[]).includes(raw) ? raw : "";
  const template = templateId ? getTemplate(templateId) : undefined;
  const profile = templateId ? profileById(templateId) : null;
  const canLive = templateCanLiveDeploy(templateId, profile?.path);
  const [phase, setPhase] = useState<Phase>(templateId ? "checking" : "error");
  const [message, setMessage] = useState("");
  const [projectId, setProjectId] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (!templateId || started.current) return;
    started.current = true;
    let cancelled = false;

    (async () => {
      setPhase("checking");
      const session = await fetch("/api/auth/session", { cache: "no-store" }).then((r) => r.json()).catch(() => null);
      if (cancelled) return;
      if (!session?.account?.login) {
        const next = `/deploy?template=${encodeURIComponent(templateId)}`;
        location.href = `/login?next=${encodeURIComponent(next)}`;
        return;
      }

      setPhase("creating");
      const name = templateDeployName(templateId);
      const created = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, templateId, description: template?.summary.en }),
      })
        .then(async (r) => ({ ok: r.ok, status: r.status, body: await r.json().catch(() => ({})) }))
        .catch((e: unknown) => ({
          ok: false,
          status: 0,
          body: { error: e instanceof Error ? e.message : String(e) },
        }));
      if (cancelled) return;
      if (!created.ok) {
        if (created.status === 401) {
          const next = `/deploy?template=${encodeURIComponent(templateId)}`;
          location.href = `/login?next=${encodeURIComponent(next)}`;
          return;
        }
        setPhase("error");
        setMessage(String((created.body as { error?: string }).error ?? (th ? "สร้างโปรเจกต์ไม่สำเร็จ" : "Could not create the project")));
        return;
      }
      const id = (created.body as { project?: { id?: string } }).project?.id;
      if (!id) {
        setPhase("error");
        setMessage(th ? "ตอบกลับจากเซิร์ฟเวอร์ไม่ครบ" : "Server response was incomplete");
        return;
      }
      setProjectId(id);

      if (!canLive) {
        setPhase("done");
        location.href = `/projects/${encodeURIComponent(id)}`;
        return;
      }

      setPhase("deploying");
      try {
        const deploymentId = await requestDeploy(id, null, null, "devstack");
        if (cancelled) return;
        setPhase("done");
        location.href = `/deployments/${encodeURIComponent(deploymentId)}`;
      } catch (e) {
        if (cancelled) return;
        setPhase("error");
        setMessage(e instanceof Error ? e.message : String(e));
        setTimeout(() => {
          location.href = `/projects/${encodeURIComponent(id)}`;
        }, 1600);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [templateId, canLive, template?.summary.en, th]);

  if (!templateId) {
    return (
      <Card className="mx-auto mt-10 max-w-lg p-6">
        <h1 className="text-lg font-semibold text-fg">{th ? "ไม่พบเทมเพลต" : "Template not found"}</h1>
        <p className="mt-2 text-sm text-subtle">{th ? "ลิงก์ Deploy ต้องมี ?template=<id> ที่ถูกต้อง" : "Deploy links need a valid ?template=<id>."}</p>
        <Link href="/templates" className={`${buttonClasses("primary", "md")} mt-4 inline-flex`}>{th ? "กลับไปคลังเทมเพลต" : "Back to templates"}</Link>
      </Card>
    );
  }

  const title = template?.name[lang] ?? templateId;
  const statusLabel =
    phase === "checking" ? (th ? "กำลังตรวจสอบบัญชี..." : "Checking your account...")
      : phase === "creating" ? (th ? "กำลังสร้างโปรเจกต์จากเทมเพลต..." : "Creating a project from the template...")
        : phase === "deploying" ? (th ? "กำลังเริ่ม Deploy บน DevStack..." : "Starting Deploy on DevStack...")
          : phase === "done" ? (th ? "กำลังพาไปหน้า Deploy..." : "Opening the Deploy page...")
            : (th ? "มีข้อผิดพลาด" : "Something went wrong");

  return (
    <Card className="mx-auto mt-10 max-w-lg p-6" aria-live="polite">
      <div className="flex items-center gap-2">
        <Rocket className="h-5 w-5 text-fg" aria-hidden />
        <h1 className="text-lg font-semibold text-fg">{th ? "Deploy เทมเพลต" : "Deploy template"}</h1>
      </div>
      <p className="mt-2 text-sm text-fg">{title}</p>
      <p className="mt-1 text-sm text-subtle">
        {canLive
          ? (th ? "สร้างโปรเจกต์บนโฮสต์ติ้งของ DevStack (ไม่สร้าง repo บน GitHub) แล้วเริ่ม Deploy ให้ได้ลิงก์สด" : "Creates a DevStack-hosted project (no GitHub repo) and starts Deploy for a live URL.")
          : (th ? "เทมเพลตนี้ไม่ใช่เว็บแอปบน Workers — จะสร้างโปรเจกต์บน DevStack ให้ แล้วพาไปหน้ารายละเอียด" : "This template is not a Workers web app — we create a DevStack project and open its page.")}
      </p>
      <div className="mt-5 flex items-center gap-3 text-sm text-fg">
        {phase !== "error" && phase !== "done" && <Spinner size="sm" />}
        <span>{statusLabel}</span>
      </div>
      {message && <p role="alert" className="mt-3 rounded-lg border border-fg/40 px-3 py-2 text-sm text-fg">{message}</p>}
      {phase === "error" && projectId && (
        <Link href={`/projects/${encodeURIComponent(projectId)}`} className={`${buttonClasses("primary", "md")} mt-4 inline-flex`}>
          {th ? "ไปที่โปรเจกต์" : "Open project"}
        </Link>
      )}
      {phase === "error" && !projectId && (
        <Link href={`/templates/${encodeURIComponent(templateId)}`} className={`${buttonClasses("secondary", "md")} mt-4 inline-flex`}>
          {th ? "กลับไปเทมเพลต" : "Back to template"}
        </Link>
      )}
    </Card>
  );
}
