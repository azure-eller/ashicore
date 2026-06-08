import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { listMcpOAuthTokenGrants } from "@/lib/agent/mcp-oauth/service";
import { assertTeamManagementAccess } from "@/lib/dal/auth";

export const runtime = "nodejs";

export const GET = apiHandler(async (request) => {
  await assertTeamManagementAccess(request.headers);
  const grants = await listMcpOAuthTokenGrants();

  return NextResponse.json({ grants });
});
