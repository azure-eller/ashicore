import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import {
  getDailyManufacturingReportScheduleForRequest,
  updateDailyManufacturingReportSchedule,
} from "@/lib/dal/reports";
import { updateDailyManufacturingReportScheduleSchema } from "@/lib/schemas/reports";

export const GET = apiHandler(async (request: Request) => {
  const data = await getDailyManufacturingReportScheduleForRequest(request.headers);
  return NextResponse.json(data);
});

export const PUT = apiHandler(async (request: Request) => {
  const data = updateDailyManufacturingReportScheduleSchema.parse(await request.json());
  const result = await updateDailyManufacturingReportSchedule(request.headers, data);
  return NextResponse.json(result);
});
