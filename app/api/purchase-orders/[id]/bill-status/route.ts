import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, type RouteContext } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { jsonNotFound } from "@/lib/api/responses";
import { setPurchaseBillManualStatus } from "@/lib/purchasing/queries/bills";

const billStatusSchema = z.object({
  status: z.enum(["not_billed", "partly_billed", "billed"]).nullable(),
});

export const PATCH = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("purchasing", request.headers);
  const { id } = await (ctx as RouteContext).params;
  const { status } = await parseJsonBody(request, billStatusSchema);
  const order = await setPurchaseBillManualStatus(id, status);

  if (!order) {
    return jsonNotFound("Purchase order not found");
  }

  return NextResponse.json(order);
});
