#!/usr/bin/env bash
# Push the "Vercel templates" section to developer-devstack/devstack.bid
# Usage:  bash push-vercel-templates.sh [repo-dir]
# Default repo-dir: ~/devstack.bid
set -euo pipefail

REPO_DIR="${1:-$HOME/devstack.bid}"
BRANCH="feat/vercel-templates-section"
REMOTE_URL="https://github.com/developer-devstack/devstack.bid.git"

if [ ! -d "$REPO_DIR/.git" ]; then
  echo "==> cloning $REMOTE_URL into $REPO_DIR"
  git clone "$REMOTE_URL" "$REPO_DIR"
fi

cd "$REPO_DIR"

if [ -z "$(git config user.email || true)" ]; then
  echo "==> no git identity set, using a local one for this repo"
  git config user.name "devstack"
  git config user.email "dev@devstack.bid"
fi

echo "==> fetching origin/main"
git fetch origin main
git checkout -B "$BRANCH" origin/main

echo "==> applying patch"
git apply --3way <<'PATCH'
diff --git a/src/app/templates/page.tsx b/src/app/templates/page.tsx
index 9c1b2dc..8a56a66 100644
--- a/src/app/templates/page.tsx
+++ b/src/app/templates/page.tsx
@@ -1,6 +1,7 @@
 import type { Metadata } from "next";
 import { Catalog } from "@/components/catalog";
 import { T } from "@/components/prefs";
+import { VercelTemplates } from "@/components/vercel-templates";
 
 export const metadata: Metadata = { title: "Templates" };
 
@@ -16,6 +17,9 @@ export default function TemplatesPage() {
       <div className="mt-8">
         <Catalog />
       </div>
+      <div className="mt-16">
+        <VercelTemplates />
+      </div>
     </div>
   );
 }
diff --git a/src/components/vercel-templates.tsx b/src/components/vercel-templates.tsx
new file mode 100644
index 0000000..12ff754
--- /dev/null
+++ b/src/components/vercel-templates.tsx
@@ -0,0 +1,147 @@
+"use client";
+
+import { useState } from "react";
+import { ArrowUpRight, ExternalLink, Star } from "lucide-react";
+import { VERCEL_TEMPLATES, type VercelTemplate } from "@/data/vercel-templates";
+import { Badge, Button, Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui";
+import { useLang } from "./prefs";
+
+type ImportResponse = { ok?: boolean; error?: string; code?: string; project?: { id?: string } };
+type ImportError = { message: string; href?: string; label?: string };
+
+export function VercelTemplates() {
+  const { lang } = useLang();
+  const [busy, setBusy] = useState<string | null>(null);
+  const [error, setError] = useState<ImportError | null>(null);
+
+  async function deploy(template: VercelTemplate) {
+    setBusy(template.repo);
+    setError(null);
+    try {
+      const res = await fetch("/api/projects/import", {
+        method: "POST",
+        headers: { "Content-Type": "application/json" },
+        body: JSON.stringify({ repo: template.repo }),
+      });
+      const body = (await res.json().catch(() => ({}))) as ImportResponse;
+      if (!res.ok) {
+        if (res.status === 401) {
+          setError(
+            body.code === "reauth"
+              ? {
+                  message: lang === "th" ? "ยังไม่ได้เชื่อมต่อ GitHub" : "GitHub is not connected yet.",
+                  href: "/settings/connections",
+                  label: lang === "th" ? "เชื่อมต่อ GitHub" : "Connect GitHub",
+                }
+              : {
+                  message: lang === "th" ? "ต้องเข้าสู่ระบบก่อน" : "Sign in first.",
+                  href: "/login",
+                  label: lang === "th" ? "เข้าสู่ระบบ" : "Sign in",
+                }
+          );
+          return;
+        }
+        setError({ message: body.error ?? (lang === "th" ? "นำเข้าไม่สำเร็จ" : "Import failed") });
+        return;
+      }
+      if (body.project?.id) {
+        window.location.href = `/projects/${encodeURIComponent(body.project.id)}`;
+        return;
+      }
+      setError({
+        message: lang === "th" ? "นำเข้าสำเร็จ แต่ไม่พบรหัสโปรเจกต์" : "Imported, but no project id was returned.",
+      });
+    } catch {
+      setError({ message: lang === "th" ? "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้" : "Could not reach the server." });
+    } finally {
+      setBusy(null);
+    }
+  }
+
+  return (
+    <section aria-labelledby="vercel-templates-heading" className="scroll-mt-24">
+      <div className="flex flex-wrap items-end justify-between gap-3">
+        <div>
+          <h2 id="vercel-templates-heading" className="text-2xl font-bold tracking-tight text-fg">
+            {lang === "th" ? "เทมเพลตจาก Vercel" : "Vercel templates"}
+          </h2>
+          <p className="mt-1 max-w-2xl text-sm text-muted">
+            {lang === "th"
+              ? "รีโปสตาร์ทเตอร์อย่างเป็นทางการของ Vercel — นำเข้ามาเป็นโปรเจกต์แล้ว build ได้ทันที"
+              : "Official Vercel starter repos. Import one as a project and build it right away."}
+          </p>
+        </div>
+        <a
+          href="https://vercel.com/templates"
+          target="_blank"
+          rel="noreferrer"
+          className="focus-ring motion-fast inline-flex items-center gap-1 text-sm text-link hover:underline"
+        >
+          {lang === "th" ? "ดูทั้งหมดบน Vercel" : "Browse all on Vercel"}
+          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
+        </a>
+      </div>
+
+      {error ? (
+        <p
+          role="alert"
+          className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 text-sm text-danger-fg"
+        >
+          {error.message}
+          {error.href ? (
+            <a href={error.href} className="font-semibold underline underline-offset-2">
+              {error.label}
+            </a>
+          ) : null}
+        </p>
+      ) : null}
+
+      <ul className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
+        {VERCEL_TEMPLATES.map((template) => (
+          <Card as="li" key={template.repo} className="flex flex-col">
+            <CardHeader>
+              <div className="flex items-start justify-between gap-2">
+                <CardTitle>{template.name[lang]}</CardTitle>
+                <span className="inline-flex shrink-0 items-center gap-1 text-xs text-subtle">
+                  <Star className="h-3.5 w-3.5" aria-hidden="true" />
+                  {template.stars.toLocaleString("en-US")}
+                </span>
+              </div>
+              <p className="font-mono text-[11px] text-subtle">{template.repo}</p>
+            </CardHeader>
+            <CardContent className="flex flex-1 flex-col gap-3">
+              <p className="text-sm text-muted">{template.summary[lang]}</p>
+              <div className="flex flex-wrap gap-1.5">
+                {template.tags.map((tag) => (
+                  <Badge key={tag} size="sm" variant="outline">
+                    {tag}
+                  </Badge>
+                ))}
+              </div>
+              {template.needsEnv ? (
+                <p className="mt-auto text-xs text-subtle">
+                  <span className="font-semibold text-muted">{lang === "th" ? "ต้องตั้งค่า: " : "Needs: "}</span>
+                  {template.needsEnv[lang]}
+                </p>
+              ) : null}
+            </CardContent>
+            <CardFooter className="justify-between">
+              <Button size="sm" loading={busy === template.repo} onClick={() => deploy(template)}>
+                {lang === "th" ? "นำเข้าและ build" : "Import & build"}
+              </Button>
+              <a
+                href={`https://github.com/${template.repo}`}
+                target="_blank"
+                rel="noreferrer"
+                className="focus-ring motion-fast inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs text-muted hover:text-fg"
+              >
+                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
+                GitHub
+              </a>
+            </CardFooter>
+          </Card>
+        ))}
+      </ul>
+    </section>
+  );
+}
diff --git a/src/data/vercel-templates.ts b/src/data/vercel-templates.ts
new file mode 100644
index 0000000..02aba7f
--- /dev/null
+++ b/src/data/vercel-templates.ts
@@ -0,0 +1,90 @@
+export interface VercelTemplate {
+  /** GitHub `owner/name` — the exact repo the import API links. */
+  repo: string;
+  name: { en: string; th: string };
+  summary: { en: string; th: string };
+  tags: string[];
+  stars: number;
+  /** Environment variables the template needs before it will run. */
+  needsEnv?: { en: string; th: string };
+}
+
+/** Official Vercel-maintained starter repos, verified to have a root package.json. */
+export const VERCEL_TEMPLATES: VercelTemplate[] = [
+  {
+    repo: "vercel/ai-chatbot",
+    name: { en: "AI Chatbot", th: "แชทบอท AI" },
+    summary: {
+      en: "Full-featured Next.js AI chatbot with streaming, tool calls, artifacts and chat history.",
+      th: "แชทบอท AI บน Next.js แบบครบฟีเจอร์ มี streaming, tool calls, artifacts และประวัติแชท",
+    },
+    tags: ["Next.js", "AI SDK", "Postgres", "Auth"],
+    stars: 21038,
+    needsEnv: { en: "AI Gateway key / model provider", th: "AI Gateway key หรือ model provider" },
+  },
+  {
+    repo: "vercel/commerce",
+    name: { en: "Next.js Commerce", th: "Next.js Commerce" },
+    summary: {
+      en: "High-performance ecommerce storefront with a Shopify backend.",
+      th: "หน้าร้าน ecommerce ประสิทธิภาพสูง เชื่อมต่อ Shopify",
+    },
+    tags: ["Next.js", "Shopify", "Ecommerce"],
+    stars: 14312,
+    needsEnv: { en: "Shopify store domain + token", th: "Shopify store domain และ token" },
+  },
+  {
+    repo: "vercel/nextjs-subscription-payments",
+    name: { en: "SaaS Subscription Starter", th: "SaaS Subscription Starter" },
+    summary: {
+      en: "SaaS starter with Stripe subscriptions, Supabase auth and Postgres.",
+      th: "สตาร์ทเตอร์ SaaS พร้อม Stripe subscriptions, Supabase auth และ Postgres",
+    },
+    tags: ["Next.js", "Stripe", "Supabase"],
+    stars: 7708,
+    needsEnv: { en: "Stripe + Supabase keys", th: "คีย์ Stripe และ Supabase" },
+  },
+  {
+    repo: "vercel/platforms",
+    name: { en: "Multi-tenant Platforms", th: "Multi-tenant Platforms" },
+    summary: {
+      en: "Multi-tenant app that gives every customer their own subdomain.",
+      th: "แอป multi-tenant ที่ให้ลูกค้าแต่ละรายใช้ซับโดเมนของตัวเอง",
+    },
+    tags: ["Next.js", "Multi-tenant", "Vercel"],
+    stars: 6724,
+    needsEnv: { en: "Vercel API token + wildcard domain", th: "Vercel API token และ wildcard domain" },
+  },
+  {
+    repo: "vercel/nextjs-postgres-nextauth-tailwindcss-template",
+    name: { en: "Admin Dashboard", th: "แดชบอร์ดแอดมิน" },
+    summary: {
+      en: "Admin dashboard with NextAuth, Postgres and Tailwind CSS.",
+      th: "แดชบอร์ดแอดมินด้วย NextAuth, Postgres และ Tailwind CSS",
+    },
+    tags: ["Next.js", "NextAuth", "Postgres", "Tailwind"],
+    stars: 1623,
+    needsEnv: { en: "Postgres URL + NextAuth secret", th: "Postgres URL และ NextAuth secret" },
+  },
+  {
+    repo: "vercel/nextjs-postgres-auth-starter",
+    name: { en: "Auth Starter (Drizzle)", th: "Auth Starter (Drizzle)" },
+    summary: {
+      en: "Next.js + Tailwind + TypeScript + Drizzle + NextAuth auth starter.",
+      th: "สตาร์ทเตอร์ auth ด้วย Next.js + Tailwind + TypeScript + Drizzle + NextAuth",
+    },
+    tags: ["Next.js", "Drizzle", "NextAuth", "Postgres"],
+    stars: 1054,
+    needsEnv: { en: "Postgres URL + NextAuth secret", th: "Postgres URL และ NextAuth secret" },
+  },
+  {
+    repo: "vercel/nextjs-portfolio-starter",
+    name: { en: "Portfolio Starter", th: "Portfolio Starter" },
+    summary: {
+      en: "Personal portfolio site built with Next.js and Markdown content.",
+      th: "เว็บพอร์ตโฟลิโอส่วนตัวด้วย Next.js และเนื้อหา Markdown",
+    },
+    tags: ["Next.js", "Markdown", "Portfolio"],
+    stars: 729,
+  },
+];
PATCH

git add src/app/templates/page.tsx src/components/vercel-templates.tsx src/data/vercel-templates.ts
git commit -m "feat(templates): add Vercel templates section

Lists seven official Vercel starter repos with bilingual copy, tags and
required env vars. Import & build posts to /api/projects/import and
redirects to the new project, with sign-in / connect-GitHub recovery links."

echo "==> pushing $BRANCH"
git push -u origin "$BRANCH"

echo
echo "==> done. open the PR here:"
echo "https://github.com/developer-devstack/devstack.bid/compare/main...$BRANCH?expand=1"
