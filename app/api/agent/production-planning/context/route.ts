import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler } from "@/lib/api/handler";
import {
  authenticateAgentBearerToken,
  readBearerToken,
} from "@/lib/agent/external-access/tokens";
import {
  getAgentProductionPlanningContext,
  getAgentProductionPlanningContextForOrg,
} from "@/lib/agent/production-planning-context/service";
import { assertPlanningReadAccess } from "@/lib/planning/auth";

const booleanQuerySchema = z
  .enum(["true", "false"])
  .optional()
  .transform((value) => (value == null ? undefined : value === "true"));

const querySchema = z.object({
  includePlanningFacts: booleanQuerySchema,
  includeLots: booleanQuerySchema,
});

export const GET = apiHandler(async (request) => {
  const url = new URL(request.url);
  const query = querySchema.parse(Object.fromEntries(url.searchParams.entries()));
  const bearerToken = readBearerToken(request.headers);

  if (bearerToken) {
    const agentAuth = await authenticateAgentBearerToken(
      bearerToken,
      "production_planning:read"
    );
    const context = await getAgentProductionPlanningContextForOrg(
      agentAuth.orgId,
      query
    );

    return NextResponse.json(context);
  }

  await assertPlanningReadAccess(request.headers);
  const context = await getAgentProductionPlanningContext(query);

  return NextResponse.json(context);
});
