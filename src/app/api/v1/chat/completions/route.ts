import { connection } from "next/server";
import { handleChatCompletions } from "@/lib/openai-compat/completions";
import { openAiError } from "@/lib/openai-compat/errors";


/** POST /api/v1/chat/completions — OpenAI-compatible chat (Bearer MCP key, chat:write). */
export async function POST(req: Request) {
  await connection();
  return handleChatCompletions(req);
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Max-Age": "86400",
    },
  });
}

export async function GET() {
  return openAiError(405, "Use POST for chat completions.", { code: "method_not_allowed" });
}
