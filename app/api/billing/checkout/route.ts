import { NextResponse } from "next/server";
import { apiHandler, requireIdempotencyKey } from "@/lib/api/handler";
import { jsonError } from "@/lib/api/responses";
import { assertTeamManagementAccess } from "@/lib/dal/auth";
import {
  BillingConfigError,
  BillingConflictError,
  createCheckoutSession,
} from "@/lib/billing/stripe";
import { getBillingOffer } from "@/lib/billing/types";

export const POST = apiHandler(async (request) => {
  const context = await assertTeamManagementAccess(request.headers);
  const idempotencyKey = requireIdempotencyKey(request, "billingCheckout");

  const body = (await request
    .clone()
    .json()
    .catch(() => null)) as { flow?: unknown; lookupKey?: unknown } | null;
  const onboarding = body?.flow === "onboarding";
  const lookupKey = typeof body?.lookupKey === "string" ? body.lookupKey : null;

  if (!lookupKey || !getBillingOffer(lookupKey)) {
    return jsonError("Unknown catalog item.", 400);
  }

  try {
    const session = await createCheckoutSession({
      orgId: context.orgId,
      orgName: context.organizationName,
      userEmail: context.email,
      lookupKey,
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
