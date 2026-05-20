import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler } from "@/lib/api/handler";
import {
  authenticateAgentBearerToken,
  readBearerToken,
} from "@/lib/agent/external-access/tokens";
import {
  buildAgentProductionPlanningMarkdown,
  getAgentProductionPlanningContext,
  getAgentProductionPlanningContextForOrg,
} from "@/lib/agent/production-planning-context/service";
import { assertPlanningReadAccess } from "@/lib/planning/auth";

const booleanQuerySchema = z
  .enum(["true", "false"])
  .optional()
  .transform((value) => (value == null ? undefined : value === "true"));

const querySchema = z.object({
  format: z.enum(["markdown", "json"]).optional().default("markdown"),
  includePlanningFacts: booleanQuerySchema,
  includeLots: booleanQuerySchema,
});

function contextOptions(query: z.infer<typeof querySchema>) {
  if (query.format === "markdown") {
    return {
      includePlanningFacts: false,
      includeLots: false,
    };
  }

  return {
    includePlanningFacts: query.includePlanningFacts,
    includeLots: query.includeLots,
  };
}

function responseForContext(
  context: Awaited<ReturnType<typeof getAgentProductionPlanningContext>>,
  format: "markdown" | "json"
) {
  if (format === "json") {
    return NextResponse.json(context);
  }

  return new NextResponse(buildAgentProductionPlanningMarkdown(context), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
    },
  });
}

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
      contextOptions(query)
    );

    return responseForContext(context, query.format);
  }

  await assertPlanningReadAccess(request.headers);
  const context = await getAgentProductionPlanningContext(contextOptions(query));

  return responseForContext(context, query.format);
});
