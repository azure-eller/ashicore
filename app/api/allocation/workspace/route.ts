import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler } from "@/lib/api/handler";
import { getAuthedApiMemberContext } from "@/lib/dal/auth";
import { hasModuleAccess } from "@/lib/authz";
import { getAllocationWorkspace } from "@/lib/inventory/allocation/service";

const querySchema = z
  .object({
    demandType: z
      .enum([
        "sales_order_line",
        "sales_shipment_line",
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
  const url = new URL(request.url);
  const query = querySchema.parse(Object.fromEntries(url.searchParams.entries()));
  const context = await getAuthedApiMemberContext(request.headers);
  const canReadSales = hasModuleAccess(context.assignedRoles, "sales", "read");
  const canReadManufacturing = hasModuleAccess(
    context.assignedRoles,
    "manufacturing",
    "read"
  );
  if (query.demandType === "manufacturing_order_ingredient") {
    if (!canReadManufacturing) {
      return NextResponse.json({ error: "You do not have access to manufacturing." }, { status: 403 });
    }
  } else if (query.demandType) {
    if (!canReadSales) {
      return NextResponse.json({ error: "You do not have access to sales." }, { status: 403 });
    }
  } else if (!canReadSales && !canReadManufacturing) {
    return NextResponse.json({ error: "You do not have access to allocation." }, { status: 403 });
  }
  const workspace = await getAllocationWorkspace({
    primaryDemand:
      query.demandType && query.demandId
        ? { demandType: query.demandType, demandId: query.demandId }
        : null,
    itemId: query.itemId ?? null,
    includeManufacturingDemand: canReadManufacturing,
  });

  if (!workspace) {
    return NextResponse.json({ error: "Allocation workspace not found" }, { status: 404 });
  }

  return NextResponse.json(workspace);
});
