import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, requireIdempotencyKey } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { jsonError } from "@/lib/api/responses";
import { assertTeamManagementAccess } from "@/lib/dal/auth";
import {
  BillingConfigError,
  BillingConflictError,
  createCheckoutSession,
} from "@/lib/billing/stripe";
import { getBillingOffer } from "@/lib/billing/types";

const checkoutSchema = z.object({
  flow: z.literal("onboarding").optional(),
  lookupKey: z.string().trim().min(1),
});

export const POST = apiHandler(async (request) => {
  const context = await assertTeamManagementAccess(request.headers);
  const idempotencyKey = requireIdempotencyKey(request, "billingCheckout");
  const body = await parseJsonBody(request, checkoutSchema);
  const onboarding = body?.flow === "onboarding";
  const lookupKey = body.lookupKey;

  if (!getBillingOffer(lookupKey)) {
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
