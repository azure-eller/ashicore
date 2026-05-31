import { NextResponse } from "next/server";
import { jsonCreated } from "@/lib/api/responses";
import { z } from "zod";
import { apiHandler } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import {
  createAgentApiToken,
  listAgentApiTokens,
} from "@/lib/agent/external-access/tokens";
import { assertTeamManagementAccess } from "@/lib/dal/auth";

const createTokenSchema = z.object({
  name: z.string().trim().min(1).max(120),
  expiresAt: z
    .string()
    .datetime()
    .nullable()
    .optional()
    .transform((value) => (value ? new Date(value) : null)),
});

export const GET = apiHandler(async (request) => {
  await assertTeamManagementAccess(request.headers);
  const tokens = await listAgentApiTokens();

  return NextResponse.json({ tokens });
});

export const POST = apiHandler(async (request) => {
  await assertTeamManagementAccess(request.headers);
  const input = await parseJsonBody(request, createTokenSchema);
  const created = await createAgentApiToken(input);

  return jsonCreated(created);
});
