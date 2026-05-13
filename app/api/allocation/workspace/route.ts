import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler } from "@/lib/api/handler";
import { assertModuleReadAccess } from "@/lib/dal/auth";
import { getAllocationWorkspace } from "@/lib/inventory/allocation/service";

const querySchema = z
  .object({
    demandType: z
      .enum(["sales_order_line", "manufacturing_order_ingredient"])
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
  await assertModuleReadAccess("inventory", request.headers);
  const url = new URL(request.url);
  const query = querySchema.parse(Object.fromEntries(url.searchParams.entries()));
  const workspace = await getAllocationWorkspace({
    primaryDemand:
      query.demandType && query.demandId
        ? { demandType: query.demandType, demandId: query.demandId }
        : null,
    itemId: query.itemId ?? null,
  });

  if (!workspace) {
    return NextResponse.json({ error: "Allocation workspace not found" }, { status: 404 });
  }

  return NextResponse.json(workspace);
});
