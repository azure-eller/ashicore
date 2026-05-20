import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler } from "@/lib/api/handler";
import { revokeAgentApiToken } from "@/lib/agent/external-access/tokens";
import { assertTeamManagementAccess } from "@/lib/dal/auth";

const paramsSchema = z.object({
  id: z.string().uuid(),
});

export const DELETE = apiHandler(
  async (request, context: { params: Promise<{ id: string }> }) => {
    await assertTeamManagementAccess(request.headers);
    const { id } = paramsSchema.parse(await context.params);
    const token = await revokeAgentApiToken(id);

    return NextResponse.json({ token });
  }
);
