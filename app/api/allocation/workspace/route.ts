import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler } from "@/lib/api/handler";
import { jsonError, jsonNotFound } from "@/lib/api/responses";
import { getAuthedApiMemberContext } from "@/lib/dal/auth";
import { hasModuleAccess } from "@/lib/authz";
import { getAllocationWorkspace } from "@/lib/inventory/allocation/service";
import {
  requestSearchParamRecord,
  requestSearchParams,
} from "@/lib/routing/search-params";

const querySchema = z
  .object({
    demandType: z
      .enum([
        "sales_order_line",
        "manufacturing_order_ingredient",
      ])
      .optional(),
    demandId: z.string().uuid().optional(),
    itemId: z.string().uuid().optional(),
  })
  .superRefine((value, ctx) => {
    if ((value.demandType == null) !== (value.demandId == null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "demandType and demandId must be provided together",
        path: ["demandId"],
      });
    }
    if (value.itemId == null && value.demandId == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide either itemId or demandType and demandId",
        path: ["itemId"],
      });
    }
  });

export const GET = apiHandler(async (request: Request) => {
  const searchParams = requestSearchParams(request);
  const query = querySchema.parse(requestSearchParamRecord(request));
  const demandIds = [...new Set(searchParams.getAll("demandId"))].filter(
    Boolean
  );
  const context = await getAuthedApiMemberContext(request.headers);
  const canReadSales = hasModuleAccess(context.assignedRoles, "sales", "read");
  const canReadManufacturing = hasModuleAccess(
    context.assignedRoles,
    "manufacturing",
    "read"
  );
  if (query.demandType === "manufacturing_order_ingredient") {
    if (!canReadManufacturing) {
      return jsonError("You do not have access to manufacturing.", 403);
    }
  } else if (query.demandType) {
    if (!canReadSales) {
      return jsonError("You do not have access to sales.", 403);
    }
  } else if (!canReadSales && !canReadManufacturing) {
    return jsonError("You do not have access to allocation.", 403);
  }
  const demandType = query.demandType;
  const workspace = await getAllocationWorkspace({
    primaryDemand: demandType && query.demandId
      ? { demandType, demandId: query.demandId }
      : null,
    primaryDemands:
      demandType && demandIds.length > 1
        ? demandIds.map((demandId) => ({ demandType, demandId }))
        : null,
    itemId: query.itemId ?? null,
    includeManufacturingDemand: canReadManufacturing,
  });

  if (!workspace) {
    return jsonNotFound("Allocation workspace not found");
  }

  return NextResponse.json(workspace);
});
