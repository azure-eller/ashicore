import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { retryFailedXeroPushes } from "@/lib/xero/retry-failed-pushes";

export const dynamic = "force-dynamic";

/**
 * Test-only helper for `pnpm xero:smoke`. Runs the same retry logic the
 * cron route runs, but auth-gated by sales:write instead of the cron
 * secret so the smoke doesn't have to ship a CRON_SECRET around. Real
 * cron traffic still goes through /api/internal/xero-retry.
 */
export const POST = apiHandler(async (request: Request) => {
  await assertModuleWriteAccess("sales", request.headers);
  const summary = await retryFailedXeroPushes();
  return NextResponse.json(summary);
});
