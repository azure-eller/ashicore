import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { assertTeamManagementAccess } from "@/lib/dal/auth";
import { manualSendDailyManufacturingReportForOrg } from "@/lib/reports/daily-manufacturing";
import { manualSendDailyManufacturingReportSchema } from "@/lib/schemas/reports";

export const POST = apiHandler(async (request: Request) => {
  const context = await assertTeamManagementAccess(request.headers);
  const input = manualSendDailyManufacturingReportSchema.parse(await request.json());
  const result = await manualSendDailyManufacturingReportForOrg({
    organizationId: context.orgId,
    reportDate: input.reportDate,
  });

  return NextResponse.json(result);
});
