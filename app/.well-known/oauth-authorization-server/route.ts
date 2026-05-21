import { NextResponse } from "next/server";
import { getCanonicalAppUrl } from "@/lib/app-url";

export const runtime = "nodejs";

export function GET() {
  const issuer = getCanonicalAppUrl();

  return NextResponse.json({
    issuer,
    authorization_endpoint: `${issuer}/api/agent/mcp/oauth/authorize`,
    token_endpoint: `${issuer}/api/agent/mcp/oauth/token`,
    scopes_supported: ["production_planning:read"],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    client_id_metadata_document_supported: true,
  });
}
