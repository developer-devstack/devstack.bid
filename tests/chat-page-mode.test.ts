import { describe, expect, it } from "vitest";
import { chatPageHref, parseChatPageMode } from "@/lib/chat/page-mode";

describe("parseChatPageMode", () => {
  it("defaults to ask", () => {
    expect(parseChatPageMode(null)).toEqual({ page: "ask" });
    expect(parseChatPageMode("")).toEqual({ page: "ask" });
    expect(parseChatPageMode("chat")).toEqual({ page: "ask" });
    expect(parseChatPageMode("ASK")).toEqual({ page: "ask" });
  });

  it("maps build and legacy aliases", () => {
    expect(parseChatPageMode("build")).toEqual({ page: "build" });
    expect(parseChatPageMode("aisite")).toEqual({ page: "build" });
    expect(parseChatPageMode("ai-build")).toEqual({ page: "build" });
  });

  it("maps dev / agent", () => {
    expect(parseChatPageMode("dev")).toEqual({ page: "dev" });
    expect(parseChatPageMode("agent")).toEqual({ page: "dev" });
    expect(parseChatPageMode("orchestrator")).toEqual({ page: "dev" });
  });

  it("maps Ask model shortcuts", () => {
    expect(parseChatPageMode("code")).toEqual({ page: "ask", model: "code" });
    expect(parseChatPageMode("thai")).toEqual({ page: "ask", model: "thai" });
    expect(parseChatPageMode("strong")).toEqual({ page: "ask", model: "strong" });
    expect(parseChatPageMode("image")).toEqual({ page: "ask", model: "image" });
    expect(parseChatPageMode("general")).toEqual({ page: "ask", model: "general" });
  });

  it("falls back on unknown values", () => {
    expect(parseChatPageMode("nope")).toEqual({ page: "ask" });
  });
});

describe("chatPageHref", () => {
  it("writes canonical query strings", () => {
    expect(chatPageHref("ask")).toBe("/chat");
    expect(chatPageHref("ask", "code")).toBe("/chat?mode=code");
    expect(chatPageHref("build")).toBe("/chat?mode=build");
    expect(chatPageHref("dev")).toBe("/chat?mode=dev");
  });
});
