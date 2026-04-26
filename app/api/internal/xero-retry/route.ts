import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { AuthorizationError } from "@/lib/authz";
import { retryFailedXeroPushes } from "@/lib/xero/retry-failed-pushes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function assertCronAccess(request: Request) {
  const secret =
    process.env.XERO_RETRY_SECRET ?? process.env.CRON_SECRET;

  if (!secret) {
    throw new Error("XERO_RETRY_SECRET or CRON_SECRET must be configured.");
  }

  const authorization = request.headers.get("authorization");

  if (authorization !== `Bearer ${secret}`) {
    throw new AuthorizationError("Invalid Xero retry token.", 401);
  }
}

export const GET = apiHandler(async (request: Request) => {
  assertCronAccess(request);

  const summary = await retryFailedXeroPushes();
  return NextResponse.json({ ok: true, ...summary });
});
