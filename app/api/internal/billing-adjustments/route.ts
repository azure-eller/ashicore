import { apiHandler } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/responses";
import { AuthorizationError } from "@/lib/authz";
import { processPendingBucketAdjustmentsForAllOrgs } from "@/lib/billing/buckets";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function assertBillingAdjustmentsAccess(request: Request) {
  const secret = env.BILLING_ADJUSTMENTS_SECRET ?? env.CRON_SECRET;

  if (!secret) {
    throw new Error("BILLING_ADJUSTMENTS_SECRET or CRON_SECRET must be configured.");
  }

  const authorization = request.headers.get("authorization");

  if (authorization !== `Bearer ${secret}`) {
    throw new AuthorizationError("Invalid billing adjustments token.", 401);
  }
}

export const GET = apiHandler(async (request: Request) => {
  assertBillingAdjustmentsAccess(request);

  const summary = await processPendingBucketAdjustmentsForAllOrgs();
  return jsonOk(summary);
});
