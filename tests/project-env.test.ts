import { describe, expect, it } from "vitest";
import {
  RESERVED_WORKER_ENV,
  validProjectEnvName,
  workerSecretBindingsFromEnv,
} from "@/lib/projects/project-env";

describe("project environment secrets", () => {
  it("accepts standard env names and rejects reserved Worker bindings", () => {
    expect(validProjectEnvName("DATABASE_URL")).toBe(true);
    expect(validProjectEnvName("AUTH_SECRET")).toBe(true);
    expect(validProjectEnvName("dev")).toBe(false);
    for (const r of RESERVED_WORKER_ENV) expect(validProjectEnvName(r)).toBe(false);
  });

  it("maps plaintext to secret_text bindings for Worker upload", () => {
    expect(workerSecretBindingsFromEnv({ DATABASE_URL: "postgres://x", AUTH_SECRET: "s" })).toEqual([
      { type: "secret_text", name: "DATABASE_URL", text: "postgres://x" },
      { type: "secret_text", name: "AUTH_SECRET", text: "s" },
    ]);
    expect(workerSecretBindingsFromEnv({ DEVSTACK_PROXY_KEY: "no" })).toEqual([]);
  });
});