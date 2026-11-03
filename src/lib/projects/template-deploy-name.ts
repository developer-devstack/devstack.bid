/**
 * Hostname-safe project slug for Deploy-from-template.
 * Keeps the template id prefix so the project list stays readable.
 */
export function templateDeployName(templateId: string, rand = crypto.randomUUID().replace(/-/g, "").slice(0, 6)): string {
  const base = templateId
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 56)
    .replace(/-+$/, "") || "template";
  return `${base}-${rand}`.slice(0, 63).replace(/-+$/, "");
}

/** True when the template can produce a *.devstack.bid live URL via the hosting pipeline. */
export function templateCanLiveDeploy(templateId: string, path: string | null | undefined): boolean {
  return Boolean(templateId) && path != null && path !== "none";
}
