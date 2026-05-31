import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
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
  const data = await parseJsonBody(
    request,
    updateDailyManufacturingReportScheduleSchema,
  );
  const result = await updateDailyManufacturingReportSchedule(request.headers, data);
  return NextResponse.json(result);
});
