import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler } from "@/lib/api/handler";
import { getAgentProductionPlanningContext } from "@/lib/agent/production-planning-context/service";
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
  await assertPlanningReadAccess(request.headers);

  const url = new URL(request.url);
  const query = querySchema.parse(Object.fromEntries(url.searchParams.entries()));
  const context = await getAgentProductionPlanningContext(query);

  return NextResponse.json(context);
});
