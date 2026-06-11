import { apiHandler } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/responses";
import { AuthorizationError } from "@/lib/authz";
import { cleanupXeroSignupIntents } from "@/lib/xero/signup-intents";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function assertCronAccess(request: Request) {
  const secret =
    env.XERO_SIGNUP_CLEANUP_SECRET ?? env.CRON_SECRET;

  if (!secret) {
    throw new Error(
      "XERO_SIGNUP_CLEANUP_SECRET or CRON_SECRET must be configured."
    );
  }

  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    throw new AuthorizationError("Invalid Xero signup cleanup token.", 401);
  }
}

export const GET = apiHandler(async (request: Request) => {
  assertCronAccess(request);
  const summary = await cleanupXeroSignupIntents();
  return jsonOk(summary);
});

export const POST = GET;
