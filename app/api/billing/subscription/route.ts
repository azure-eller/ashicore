import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, requireIdempotencyKey } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { jsonError } from "@/lib/api/responses";
import { assertTeamManagementAccess } from "@/lib/dal/auth";
import {
  BillingConfigError,
  BillingSubscriptionError,
  cancelSubscriptionAtPeriodEnd,
  changeSubscriptionOffer,
  resumeSubscription,
} from "@/lib/billing/stripe";
import { getBillingOffer } from "@/lib/billing/types";

const subscriptionActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("change_offer"),
    lookupKey: z.string().trim().min(1),
  }),
  z.object({
    action: z.literal("cancel_at_period_end"),
  }),
  z.object({
    action: z.literal("resume"),
  }),
]);

export const POST = apiHandler(async (request) => {
  const context = await assertTeamManagementAccess(request.headers);
  const idempotencyKey = requireIdempotencyKey(request, "billingSubscription");
  const input = await parseJsonBody(request, subscriptionActionSchema);

  try {
    if (input.action === "change_offer") {
      if (!getBillingOffer(input.lookupKey)) {
        return jsonError("Unknown catalog item.", 400);
      }

      await changeSubscriptionOffer({
        orgId: context.orgId,
        orgName: context.organizationName,
        lookupKey: input.lookupKey,
        idempotencyKey,
      });
    } else if (input.action === "cancel_at_period_end") {
      await cancelSubscriptionAtPeriodEnd({
        orgId: context.orgId,
        orgName: context.organizationName,
        idempotencyKey,
      });
    } else {
      await resumeSubscription({
        orgId: context.orgId,
        orgName: context.organizationName,
        idempotencyKey,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof BillingConfigError) {
      return jsonError(error.message, error.status);
    }
    if (error instanceof BillingSubscriptionError) {
      return jsonError(error.message, error.status);
    }
    throw error;
  }
});
