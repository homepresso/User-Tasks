import { NextRequest } from "next/server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { validateApiKey } from "@/lib/api-auth";
import {
  createMcpProtocolServer,
  getContextToolServer,
  type McpContext,
} from "@/lib/mcp/server";
import { buildMcpInfoPayload } from "@/lib/mcp/metadata";
import { configuredAppUrl } from "@/lib/config/bootstrap";
import { apiMaxBodyBytes, apiMaxPackageBodyBytes, bodyTooLargeMessage, isMcpPackageCall, mentionsMcpPackageTool, readCappedBody } from "@/lib/api/body-limit";

/**
 * MCP Server — Streamable HTTP transport (2025-03-26 spec).
 * Stateless mode: each request creates a fresh protocol server + transport;
 * tool definitions/schemas are built once per process (lib/mcp/server).
 * Auth: Bearer API key on every request.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Allowed browser origins. Set MCP_ALLOWED_ORIGINS to a comma-separated list to
// lock the endpoint down for browser-based MCP clients; unset defaults to '*'
// (server-side MCP clients are unaffected by CORS either way, and auth is Bearer).
function allowedOrigins(): string[] {
  return (process.env.MCP_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

function resolveAllowOrigin(request: NextRequest): string {
  const configured = allowedOrigins();
  if (configured.length === 0) return "*";
  const origin = request.headers.get("origin") ?? "";
  return configured.includes(origin) ? origin : configured[0];
}

function corsHeaders(request: NextRequest): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": resolveAllowOrigin(request),
    Vary: "Origin",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Authorization, Content-Type, Accept, Mcp-Session-Id, Last-Event-ID",
    "Access-Control-Expose-Headers": "Mcp-Session-Id, mcp-session-id",
  };
}

function withCors(response: Response, request: NextRequest) {
  const headers = new Headers(response.headers);
  Object.entries(corsHeaders(request)).forEach(([key, value]) =>
    headers.set(key, value),
  );
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function jsonRpcError(status: number, message: string, code: number): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function handleMcpRequest(request: NextRequest): Promise<Response> {
  // Auth (Bearer API key OR OAuth 2.0 access token — both flow through
  // validateApiKey). On failure emit the RFC 9728 discovery header so MCP
  // clients (claude.ai) can find the OAuth authorization server.
  const authResult = await validateApiKey(request);
  if (!authResult.success) {
    const base =
      (configuredAppUrl() ?? "").trim().replace(/\/+$/, "") ||
      `${request.nextUrl.protocol}//${request.nextUrl.host}`;
    return withCors(
      new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Authentication required" },
          id: null,
        }),
        {
          status: 401,
          headers: {
            "Content-Type": "application/json",
            "WWW-Authenticate": `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"`,
          },
        },
      ),
      request,
    );
  }

  const ctx: McpContext = {
    tenantId: authResult.tenantId,
    supabase: authResult.supabase,
    actingUserId: authResult.actingUserId,
    keyType: authResult.keyType,
    permissions: authResult.permissions,
    scopes: authResult.scopes,
    oauthScopes: authResult.authKind === "oauth" ? authResult.oauthScopes ?? [] : undefined,
    credentialOwnerId: authResult.createdBy,
  };

  // JSON-RPC bodies are capped like /api/v1 (lib/api/body-limit): read here,
  // after auth, and handed to the transport already parsed. API_MAX_BODY_BYTES
  // for every message, except a tools/call to a tool that takes a base64
  // package or large document (MCP_PACKAGE_TOOLS), which may use
  // API_MAX_PACKAGE_BODY_BYTES — like the /api/v1 endpoints behind them.
  let parsedBody: unknown = undefined;
  if (request.method === "POST") {
    const limit = apiMaxBodyBytes();
    const packageLimit = Math.max(limit, apiMaxPackageBodyBytes());
    const body = await readCappedBody(request, packageLimit);
    if (!body.ok) {
      const tooLarge = body.reason === "too_large";
      return withCors(jsonRpcError(tooLarge ? 413 : 400, tooLarge ? bodyTooLargeMessage(packageLimit, { tier: "package", multipart: false }) : "Could not read the request body", -32600), request);
    }
    const overDefault = body.size > limit;
    const tooLargeForMessage = () => withCors(jsonRpcError(413, bodyTooLargeMessage(limit, { tier: "default", multipart: false }), -32600), request);
    if (overDefault && !mentionsMcpPackageTool(body.text)) return tooLargeForMessage();
    try {
      parsedBody = JSON.parse(body.text);
    } catch {
      return withCors(jsonRpcError(400, "Parse error: Invalid JSON", -32700), request);
    }
    if (overDefault && !isMcpPackageCall(parsedBody)) return tooLargeForMessage();
  }

  // Fresh protocol server per request (stateless); the tool catalog and the
  // context-bound handlers are cached in lib/mcp/server.
  const mcpServer = createMcpProtocolServer(ctx);

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless mode
    enableJsonResponse: true,
  });

  await mcpServer.connect(transport);

  // Let the transport handle the request (POST, GET, DELETE)
  const response = await transport.handleRequest(request, {
    authInfo: { token: "", clientId: "", scopes: [] },
    ...(parsedBody !== undefined ? { parsedBody } : {}),
  });

  // Clean up
  await mcpServer.close();

  return withCors(response, request);
}

export async function POST(request: NextRequest) {
  return handleMcpRequest(request);
}

export async function GET(request: NextRequest) {
  // Simple info endpoint when no Accept: text/event-stream
  const accept = request.headers.get("accept") ?? "";
  if (!accept.includes("text/event-stream")) {
    const authResult = await validateApiKey(request);
    const ctx = authResult.success
      ? ({
          tenantId: authResult.tenantId,
          supabase: authResult.supabase,
          actingUserId: authResult.actingUserId,
          keyType: authResult.keyType,
          permissions: authResult.permissions,
          scopes: authResult.scopes,
          oauthScopes: authResult.authKind === "oauth" ? authResult.oauthScopes ?? [] : undefined,
          credentialOwnerId: authResult.createdBy,
        } satisfies McpContext)
      : null;
    const toolServer = ctx ? getContextToolServer(ctx) : null;

    return withCors(
      new Response(JSON.stringify(buildMcpInfoPayload(toolServer)), {
        headers: { "Content-Type": "application/json" },
      }),
      request,
    );
  }
  return handleMcpRequest(request);
}

export async function DELETE(request: NextRequest) {
  return handleMcpRequest(request);
}

export async function OPTIONS(request: NextRequest) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request),
  });
}
