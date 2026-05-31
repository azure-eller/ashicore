import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { jsonNotFound } from "@/lib/api/responses";
import { requireReportReadAccessForRequest } from "@/lib/dal/reports";
import { getDailyManufacturingReportRun } from "@/lib/reports/daily-manufacturing";

export const GET = apiHandler(async (request: Request, ctx: unknown) => {
  await requireReportReadAccessForRequest(request.headers);
  const { id } = await (ctx as { params: Promise<{ id: string }> }).params;
  const report = await getDailyManufacturingReportRun(id);

  if (!report) {
    return jsonNotFound("Report not found.");
  }

  return NextResponse.json(report);
});
