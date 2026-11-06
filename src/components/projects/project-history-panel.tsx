"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FolderGit2 } from "lucide-react";
import { cn } from "@/components/ui";
import { useLang } from "@/components/prefs";
import { fetchProjectList, type ProjectListItem } from "@/lib/projects/api-client";

/** Lists the signed-in user's projects (GET /api/projects). Used in the main nav sheet and optionally on /projects. */
export function ProjectHistoryPanel({
  onNavigate,
  className,
  variant = "sheet",
}: {
  /** Close the mobile sheet when a link is chosen. */
  onNavigate?: () => void;
  className?: string;
  /** `inline`: compact strip in the desktop header bar. `sheet`: default card in the hamburger menu. */
  variant?: "sheet" | "inline";
}) {
  const { t, lang } = useLang();
  const th = lang === "th";
  const [items, setItems] = useState<ProjectListItem[]>([]);
  const [unauthorized, setUnauthorized] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let on = true;
    fetchProjectList()
      .then((x) => {
        if (!on) return;
        setError("");
        setItems(x.projects);
        setUnauthorized(x.unauthorized);
      })
      .catch((e: unknown) => on && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => on && setLoading(false));
    return () => {
      on = false;
    };
  }, []);

  const loginHref = typeof window !== "undefined" ? `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}` : "/login";

  const shell = variant === "inline" ? "p-0 px-1" : "rounded-lg border border-border bg-surface-2/50 p-3";
  const titleCls = variant === "inline" ? "text-xs font-semibold uppercase tracking-wide text-subtle" : "text-sm font-semibold text-fg";
  const listMax = variant === "inline" ? "max-h-48" : "max-h-[min(40vh,22rem)]";

  return (
    <section className={cn(shell, className)} aria-labelledby="project-history-heading">
      <h2 id="project-history-heading" className={titleCls}>
        {t("nav.projectHistory")}
      </h2>
      {loading && <p className={cn("text-sm text-subtle", variant === "inline" ? "mt-1" : "mt-2")}>{th ? "กำลังโหลด…" : "Loading…"}</p>}
      {error && (
        <p role="alert" className={cn("text-sm text-fg", variant === "inline" ? "mt-1" : "mt-2")}>
          {error}
        </p>
      )}
      {!loading && !error && items.length === 0 && unauthorized && (
        <p className={cn("text-xs leading-snug text-subtle", variant === "inline" ? "mt-1" : "mt-2")}>
          {t("nav.projectHistorySignIn")}
          {" "}
          <a href={loginHref} onClick={onNavigate} className="font-medium text-fg underline underline-offset-4">
            {t("auth.signIn")}
          </a>
        </p>
      )}
      {!loading && !error && items.length === 0 && !unauthorized && (
        <p className={cn("text-xs leading-snug text-subtle", variant === "inline" ? "mt-1" : "mt-2")}>{t("nav.projectHistoryNone")}</p>
      )}
      {!loading && !error && items.length > 0 && (
        <ul className={cn("mt-2 divide-y divide-border overflow-y-auto rounded-md border border-border bg-bg", listMax)}>
          {items.map((p) => (
            <li key={p.id}>
              <Link
                href={`/projects/${p.id}`}
                onClick={onNavigate}
                className="focus-ring flex min-h-11 items-center gap-2.5 px-3 py-2.5 text-left hover:bg-surface-2"
              >
                <FolderGit2 className="h-4 w-4 shrink-0 text-subtle" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-fg">{p.name}</span>
                  {p.repo && <span className="block truncate font-mono text-[11px] text-subtle sm:text-xs">{p.repo}</span>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
