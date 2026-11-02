import { connection } from "next/server";
import { handleListModels } from "@/lib/openai-compat/completions";
import { openAiError } from "@/lib/openai-compat/errors";


/** GET /api/v1/models — OpenAI-compatible model list (Bearer MCP key, chat:read or chat:write). */
export async function GET(req: Request) {
  await connection();
  return handleListModels(req);
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Max-Age": "86400",
    },
  });
}

export async function POST() {
  return openAiError(405, "Use GET to list models.", { code: "method_not_allowed" });
}
