import "server-only";
import { json } from "@/lib/chat/runtime";
import { customDomainsFeatureOn, serverBindingsFeatureOn } from "./config";

export function domainsDisabledResponse() {
  return json(
    {
      error: "Custom domains are not open yet. / ยังไม่เปิดใช้โดเมนของคุณ",
      code: "feature_disabled",
    },
    503,
  );
}

export function bindingsDisabledResponse() {
  return json(
    {
      error: "Server bindings are not open yet. / ยังไม่เปิดใช้ server bindings",
      code: "feature_disabled",
    },
    503,
  );
}

export function hostingCapabilities() {
  return {
    customDomains: customDomainsFeatureOn(),
    serverBindings: serverBindingsFeatureOn(),
  };
}
