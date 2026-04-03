import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { assertModuleReadAccess, assertModuleWriteAccess } from "@/lib/dal/auth";
import { insertPricingScheduleSchema } from "@/lib/schemas/pricing-schedules";
import { bulkDeleteSchema } from "@/lib/schemas/shared";
import {
  createPricingSchedule,
  deletePricingSchedules,
  getPricingSchedules,
  SalesError,
} from "@/app/(dashboard)/sales/queries";

export const GET = apiHandler(async (request) => {
  await assertModuleReadAccess("sales", request.headers);
  const schedules = await getPricingSchedules();
  return NextResponse.json(schedules);
});

export const POST = apiHandler(async (request) => {
  await assertModuleWriteAccess("sales", request.headers);
  const body = await request.json();
  const data = insertPricingScheduleSchema.parse(body);

  try {
    const schedule = await createPricingSchedule(data);
    return NextResponse.json(schedule, { status: 201 });
  } catch (error) {
    if (error instanceof SalesError) return error.toResponse();
    throw error;
  }
});

export const DELETE = apiHandler(async (request) => {
  await assertModuleWriteAccess("sales", request.headers);
  const body = await request.json();
  const data = bulkDeleteSchema.parse(body);

  try {
    const result = await deletePricingSchedules(data.ids);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof SalesError) return error.toResponse();
    throw error;
  }
});
