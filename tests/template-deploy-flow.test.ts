import { describe, expect, it } from "vitest";
import { KNOWN_TEMPLATE_IDS } from "@/data/template-ids";
import { TEMPLATES } from "@/data/templates";
import { profileById } from "@/lib/deploy/templates";
import { templateSeedFiles, templateBuild } from "@/lib/projects/template-seed";
import { templateCanLiveDeploy, templateDeployName } from "@/lib/projects/template-deploy-name";

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

describe("templateDeployName", () => {
  it("builds hostname-safe slugs from every template id", () => {
    for (const id of KNOWN_TEMPLATE_IDS) {
      const name = templateDeployName(id, "abc123");
      expect(name, id).toMatch(SLUG);
      expect(name.length).toBeLessThanOrEqual(63);
    }
  });

  it("is stable for a fixed rand", () => {
    expect(templateDeployName("static-website", "dead01")).toBe("static-website-dead01");
  });
});

describe("templates Deploy catalog contract", () => {
  it("every catalog template has a deploy profile and seed files", () => {
    for (const t of TEMPLATES) {
      const profile = profileById(t.id);
      expect(profile, t.id).toBeTruthy();
      const files = templateSeedFiles(t.id, templateDeployName(t.id, "seed01"), t.summary.en);
      expect(files.length, t.id).toBeGreaterThan(0);
      expect(files.some((f) => f.path === "README.md"), t.id).toBe(true);
      const live = templateCanLiveDeploy(t.id, profile!.path);
      if (live) {
        expect(templateBuild(t.id), t.id).toBeTruthy();
        expect(files.some((f) => f.path === "package.json"), t.id).toBe(true);
      }
    }
  });

  it("Deploy href shape used by TemplateCard is valid for every id", () => {
    for (const id of KNOWN_TEMPLATE_IDS) {
      expect(`/deploy?template=${encodeURIComponent(id)}`).toContain(id);
    }
  });
});
