import { redirect } from "next/navigation";

/** Legacy URL: Build with AI now lives on the unified chat page. */
export default function AiBuildRedirectPage() {
  redirect("/chat?mode=build");
}
