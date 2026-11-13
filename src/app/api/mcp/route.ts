import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { resolveApiToken } from "@/db/queries/api-tokens";
import { buildRapportServer } from "@/lib/mcp/server";
import { scopeForUser } from "@/lib/scope";

// POST /api/mcp: Rapport as an MCP server (Streamable HTTP, stateless) for agents.
// Auth: `Authorization: Bearer rpt_…`, a personal API token made in Settings. The agent acts as that user.

export const dynamic = "force-dynamic";

const unauthorized = () =>
  Response.json(
    { jsonrpc: "2.0", error: { code: -32001, message: "Missing or invalid API token. Make one in Rapport → Settings → API tokens." }, id: null },
    { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="rapport"' } },
  );

async function handle(request: Request): Promise<Response> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  const who = token ? await resolveApiToken(token) : null;
  if (!who) return unauthorized();

  const server = buildRapportServer(await scopeForUser(who.id, who.name));
  // Stateless: a fresh server and transport per request, JSON responses (no long-lived streams on serverless).
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    void server.close();
  }
}

// GET would open a standalone SSE stream. This stateless server never pushes on one, and on serverless it ends at once,
// so MCP clients reconnected every few seconds, all day, and burned Vercel CPU (plus a token lookup each time).
// The MCP spec lets a server answer 405 here; clients then stop asking. Checked before auth so it costs nothing.
const noStream = () => new Response(null, { status: 405, headers: { Allow: "POST, DELETE" } });

export const POST = handle;
export const GET = noStream;
export const DELETE = handle;
