import { NextResponse } from "next/server";
import { apiHandler, type RouteContext } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { jsonSuccess } from "@/lib/api/responses";
import { assertModuleAccess } from "@/lib/dal/auth";
import { updatePricingScheduleSchema } from "@/lib/schemas/pricing-schedules";
import { deletePricingSchedule, updatePricingSchedule } from "@/app/(dashboard)/sales/queries";

export const PUT = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleAccess("sales", "admin", request.headers);
  const { id } = await (ctx as RouteContext).params;
  const data = await parseJsonBody(request, updatePricingScheduleSchema);

  const schedule = await updatePricingSchedule(id, data);

  if (!schedule) {
    return NextResponse.json(
      { error: "Pricing schedule not found" },
      { status: 404 }
    );
  }

  return NextResponse.json(schedule);
});

export const DELETE = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleAccess("sales", "admin", request.headers);
  const { id } = await (ctx as RouteContext).params;

  const result = await deletePricingSchedule(id);

  if (!result.deleted) {
    return NextResponse.json(
      { error: "Pricing schedule not found" },
      { status: 404 }
    );
  }

  return jsonSuccess();
});
