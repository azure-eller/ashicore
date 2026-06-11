import { apiHandler } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/responses";
import { AuthorizationError } from "@/lib/authz";
import { processOnboardingImports } from "@/lib/onboarding/import/extraction/worker";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function assertCronAccess(request: Request) {
  const secret = env.ONBOARDING_IMPORT_CRON_SECRET ?? env.CRON_SECRET;
  if (!secret) {
    throw new Error("ONBOARDING_IMPORT_CRON_SECRET or CRON_SECRET must be configured.");
  }

  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    throw new AuthorizationError("Invalid onboarding import worker token.", 401);
  }
}

export const GET = apiHandler(async (request) => {
  assertCronAccess(request);
  return jsonOk(await processOnboardingImports());
});
