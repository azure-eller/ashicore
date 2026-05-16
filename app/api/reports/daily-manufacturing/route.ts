import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { requireReportReadAccessForRequest } from "@/lib/dal/reports";
import { getDailyManufacturingReportHistory } from "@/lib/reports/daily-manufacturing";

export const GET = apiHandler(async (request: Request) => {
  await requireReportReadAccessForRequest(request.headers);
  const reports = await getDailyManufacturingReportHistory();
  return NextResponse.json(reports);
});
