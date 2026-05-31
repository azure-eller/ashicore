import { NextResponse } from "next/server";
import { jsonCreated } from "@/lib/api/responses";
import { apiHandler } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { assertModuleAccess } from "@/lib/dal/auth";
import { insertPricingScheduleSchema } from "@/lib/schemas/pricing-schedules";
import { bulkDeleteSchema } from "@/lib/schemas/shared";
import {
  createPricingSchedule,
  deletePricingSchedules,
  getPricingSchedules,
  SalesError,
} from "@/app/(dashboard)/sales/queries";

export const GET = apiHandler(async (request) => {
  await assertModuleAccess("sales", "admin", request.headers);
  const schedules = await getPricingSchedules();
  return NextResponse.json(schedules);
});

export const POST = apiHandler(async (request) => {
  await assertModuleAccess("sales", "admin", request.headers);
  const data = await parseJsonBody(request, insertPricingScheduleSchema);

  try {
    const schedule = await createPricingSchedule(data);
    return jsonCreated(schedule);
  } catch (error) {
    if (error instanceof SalesError) return error.toResponse();
    throw error;
  }
});

export const DELETE = apiHandler(async (request) => {
  await assertModuleAccess("sales", "admin", request.headers);
  const data = await parseJsonBody(request, bulkDeleteSchema);

  try {
    const result = await deletePricingSchedules(data.ids);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof SalesError) return error.toResponse();
    throw error;
  }
});
