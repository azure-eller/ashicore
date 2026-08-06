import { apiHandler } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/responses";
import { AuthorizationError } from "@/lib/authz";
import { env } from "@/lib/env";
import { DomainError } from "@/lib/errors/domain-error";
import { processMarketingTick } from "@/lib/marketing/tick";
import { isMarketingTestMode } from "@/lib/marketing/runtime-policy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

async function assertCronAccess(request: Request) {
  if (
    process.env.NODE_ENV !== "production" &&
    await isMarketingTestMode() &&
    request.headers.get("authorization") === "Bearer marketing-test-secret"
  ) {
    return;
  }
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
  const configuredOrgId = env.MARKETING_AUTOMATION_ORG_ID;
  const requestOrgId = new URL(request.url).searchParams.get("orgId") ?? undefined;
  const orgId = configuredOrgId ?? (process.env.NODE_ENV === "production" ? undefined : requestOrgId);
  if (!orgId) {
    throw new DomainError("MARKETING_AUTOMATION_ORG_ID must be configured.", 503);
  }
  const requestedNow = new URL(request.url).searchParams.get("now");
  const now =
    process.env.NODE_ENV !== "production" && requestedNow
      ? new Date(requestedNow)
      : undefined;
  if (now && Number.isNaN(now.getTime())) {
    throw new DomainError("Invalid marketing tick time.", 400);
  }
  return jsonOk(await processMarketingTick({ orgId, now }));
});
