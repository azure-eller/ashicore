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

  try {
    const session = await createCheckoutSession({
      orgId: context.orgId,
      orgName: context.organizationName,
      userEmail: context.email,
      idempotencyKey,
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
