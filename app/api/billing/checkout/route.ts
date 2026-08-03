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
import {
  BILLING_ADDON_LOOKUP_KEYS,
  BILLING_INTERVALS,
  PRICED_SALES_ORDER_BANDS,
  getBillingOffer,
} from "@/lib/billing/types";
import {
  billingSelectionToCommercialSelection,
  commercialSelectionFromInput,
  normalizeBillingSelection,
} from "@/lib/billing/plan-intent";

const checkoutSchema = z.object({
  flow: z.literal("onboarding").optional(),
  lookupKey: z.string().trim().min(1).optional(),
  selection: z
    .discriminatedUnion("mode", [
      z.object({ mode: z.literal("trial") }),
      z.object({ mode: z.literal("free") }),
      z.object({
        mode: z.literal("core"),
        band: z.enum(PRICED_SALES_ORDER_BANDS).optional(),
        interval: z.enum(BILLING_INTERVALS).optional(),
        locationCapacity: z.number().int().min(1).max(100).optional(),
        addonLookupKeys: z.array(z.enum(BILLING_ADDON_LOOKUP_KEYS)).optional(),
      }),
    ])
    .optional(),
});

export const POST = apiHandler(async (request) => {
  const context = await assertTeamManagementAccess(request.headers);
  const idempotencyKey = requireIdempotencyKey(request, "billingCheckout");
  const body = await parseJsonBody(request, checkoutSchema);
  const onboarding = body?.flow === "onboarding";
  const selection =
    body.selection ??
    billingSelectionToCommercialSelection(normalizeBillingSelection(body.lookupKey));

  if (selection.mode !== "core") {
    return jsonError("Checkout requires the Pro plan.", 400);
  }

  const normalizedSelection = commercialSelectionFromInput(selection);
  if (normalizedSelection?.mode !== "core") {
    return jsonError("Checkout requires the Pro plan.", 400);
  }

  for (const lookupKey of normalizedSelection.addonLookupKeys ?? []) {
    if (!getBillingOffer(lookupKey)) {
      return jsonError("Unknown catalog item.", 400);
    }
  }

  try {
    const session = await createCheckoutSession({
      orgId: context.orgId,
      orgName: context.organizationName,
      userEmail: context.email,
      selection: normalizedSelection,
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
