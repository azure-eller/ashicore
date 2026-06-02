import { NextResponse } from "next/server";
import { apiHandler, requireIdempotencyKey } from "@/lib/api/handler";
import { jsonError } from "@/lib/api/responses";
import { assertTeamManagementAccess } from "@/lib/dal/auth";
import {
  BillingConfigError,
  BillingConflictError,
  createCheckoutSession,
} from "@/lib/billing/stripe";

export const POST = apiHandler(async (request) => {
  const context = await assertTeamManagementAccess(request.headers);
  const idempotencyKey = requireIdempotencyKey(request, "billingCheckout");

  const body = (await request
    .clone()
    .json()
    .catch(() => null)) as { flow?: unknown } | null;
  const onboarding = body?.flow === "onboarding";

  try {
    const session = await createCheckoutSession({
      orgId: context.orgId,
      orgName: context.organizationName,
      userEmail: context.email,
      idempotencyKey,
      successPath: onboarding ? "/onboarding?checkout=success" : undefined,
      cancelPath: onboarding ? "/onboarding?checkout=cancel" : undefined,
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    if (error instanceof BillingConfigError) {
      return jsonError(error.message, error.status);
    }
    if (error instanceof BillingConflictError) {
      return jsonError(error.message, error.status);
    }
    throw error;
  }
});
