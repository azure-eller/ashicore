import { apiHandler } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/responses";
import { AuthorizationError } from "@/lib/authz";
import { env } from "@/lib/env";
import { DomainError } from "@/lib/errors/domain-error";
import { processMarketingTick } from "@/lib/marketing/tick";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

async function assertCronAccess(request: Request) {
  const secret = env.MARKETING_AUTOMATION_SECRET ?? env.CRON_SECRET;
  if (!secret) {
    throw new Error("MARKETING_AUTOMATION_SECRET or CRON_SECRET must be configured.");
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    throw new AuthorizationError("Invalid marketing automation token.", 401);
  }
}

export const GET = apiHandler(async (request: Request) => {
  await assertCronAccess(request);
  const orgId = env.MARKETING_AUTOMATION_ORG_ID;
  if (!orgId) {
    throw new DomainError("MARKETING_AUTOMATION_ORG_ID must be configured.", 503);
  }
  return jsonOk(await processMarketingTick({ orgId }));
});
