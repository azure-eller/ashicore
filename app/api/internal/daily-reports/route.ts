import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { AuthorizationError } from "@/lib/authz";
import { generateDueDailyManufacturingReports } from "@/lib/reports/daily-manufacturing";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function assertCronAccess(request: Request) {
  const secret = process.env.DAILY_REPORTS_SECRET ?? process.env.CRON_SECRET;

  if (!secret) {
    throw new Error("DAILY_REPORTS_SECRET or CRON_SECRET must be configured.");
  }

  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    throw new AuthorizationError("Invalid daily reports token.", 401);
  }
}

export const GET = apiHandler(async (request: Request) => {
  assertCronAccess(request);
  const summary = await generateDueDailyManufacturingReports();
  return NextResponse.json({ ok: true, ...summary });
});

export const POST = GET;
