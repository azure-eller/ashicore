import { NextResponse } from "next/server";
import { getAgentMcpProtectedResourceMetadata } from "@/lib/agent/mcp-oauth/metadata";

export const runtime = "nodejs";

export function GET() {
  return NextResponse.json(getAgentMcpProtectedResourceMetadata());
}
