import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { KNOWN_TEMPLATE_IDS } from "@/data/template-ids";
import { catalogTemplateActions } from "@/lib/deploy/catalog-actions";
import { DEPLOY_PROFILES, profileById } from "@/lib/deploy/templates";

const NOT_HOSTABLE = ["express-api", "fastapi-ai", "streamlit-dashboard", "node-cli-npx", "pypi-package"] as const;

describe("catalog template actions", () => {
  it("uses Deploy only for hostable stack templates", () => {
    for (const id of KNOWN_TEMPLATE_IDS) {
      const profile = profileById(id)!;
      const actions = catalogTemplateActions(id);
      const hostable = profile.path !== "none";
      expect(actions.hostable, id).toBe(hostable);
      expect(actions.primaryI18nKey, id).toBe(hostable ? "catalog.deploy" : "catalog.createProject");
      expect(actions.deployHref, id).toBe(`/deploy?template=${encodeURIComponent(id)}`);
      expect(actions.builderHref, id).toBe(`/builder#t=${encodeURIComponent(id)}`);
    }
  });

  it("marks source-only templates as create-project CTAs", () => {
    for (const id of NOT_HOSTABLE) {
      expect(catalogTemplateActions(id).primaryI18nKey).toBe("catalog.createProject");
      expect(DEPLOY_PROFILES[id].path).toBe("none");
    }
  });
});

describe("deploy-templates.md matches OpenNext profiles", () => {
  it("documents opennext targets for Next stack templates", () => {
    const doc = readFileSync("docs/deploy-templates.md", "utf8");
    for (const id of ["nextjs-dashboard", "nextjs-ai-chat", "collab-workspace"] as const) {
      expect(DEPLOY_PROFILES[id].target).toBe("opennext");
      expect(doc, id).toMatch(new RegExp(`\\| \`${id}\` \\| Stack template \\| opennext \\|`));
    }
  });
});
