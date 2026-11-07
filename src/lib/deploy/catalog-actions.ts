import { profileById } from "@/lib/deploy/templates";

export type CatalogPrimaryI18nKey = "catalog.deploy" | "catalog.createProject";

export interface CatalogTemplateActions {
  hostable: boolean;
  primaryI18nKey: CatalogPrimaryI18nKey;
  deployHref: string;
  builderHref: string;
}

/** Catalog / template-detail CTAs: hostable stacks lead with Deploy; source-only stacks lead with Create project. */
export function catalogTemplateActions(templateId: string): CatalogTemplateActions {
  const profile = profileById(templateId);
  const hostable = profile != null && profile.path !== "none";
  return {
    hostable,
    primaryI18nKey: hostable ? "catalog.deploy" : "catalog.createProject",
    deployHref: `/deploy?template=${encodeURIComponent(templateId)}`,
    builderHref: `/builder#t=${encodeURIComponent(templateId)}`,
  };
}
