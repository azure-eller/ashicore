import { NextResponse } from "next/server";
import { jsonCreated } from "@/lib/api/responses";
import { apiHandler } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { assertModuleAccess } from "@/lib/dal/auth";
import { insertPricingScheduleSchema } from "@/lib/schemas/pricing-schedules";
import { bulkDeleteSchema } from "@/lib/schemas/shared";
import { createPricingSchedule, deletePricingSchedules, getPricingSchedules } from "@/lib/sales/queries";

export const GET = apiHandler(async (request) => {
  await assertModuleAccess("sales", "admin", request.headers);
  const schedules = await getPricingSchedules();
  return NextResponse.json(schedules);
});

export const POST = apiHandler(async (request) => {
  await assertModuleAccess("sales", "admin", request.headers);
  const data = await parseJsonBody(request, insertPricingScheduleSchema);

  const schedule = await createPricingSchedule(data);
  return jsonCreated(schedule);
});

export const DELETE = apiHandler(async (request) => {
  await assertModuleAccess("sales", "admin", request.headers);
  const data = await parseJsonBody(request, bulkDeleteSchema);

  const result = await deletePricingSchedules(data.ids);
  return NextResponse.json(result);
});
