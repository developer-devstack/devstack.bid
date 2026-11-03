import { redirect } from "next/navigation";

/** Legacy URL: Dev Chat now lives on the unified chat page. */
export default function DevChatRedirectPage() {
  redirect("/chat?mode=dev");
}
