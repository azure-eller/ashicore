import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, type RouteContext } from "@/lib/api/handler";
import { revokeMcpOAuthTokenGrant } from "@/lib/agent/mcp-oauth/service";
import { assertTeamManagementAccess } from "@/lib/dal/auth";

export const runtime = "nodejs";

const paramsSchema = z.object({
  id: z.string().uuid(),
});

export const DELETE = apiHandler(async (request, ctx: unknown) => {
  await assertTeamManagementAccess(request.headers);
  const { id } = paramsSchema.parse(await (ctx as RouteContext).params);
  const grant = await revokeMcpOAuthTokenGrant(id);

  return NextResponse.json({ grant });
});
