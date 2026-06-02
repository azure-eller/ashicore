import { apiHandler } from "@/lib/api/handler";
import { jsonError, jsonOk } from "@/lib/api/responses";
import {
  BillingConfigError,
  BillingWebhookVerificationError,
  handleStripeWebhook,
} from "@/lib/billing/stripe";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = apiHandler(async (request) => {
  const body = await request.text();
  const signature = request.headers.get("stripe-signature");

  try {
    await handleStripeWebhook(body, signature);
    return jsonOk();
  } catch (error) {
    if (error instanceof BillingConfigError) {
      return jsonError(error.message, error.status);
    }

    if (error instanceof BillingWebhookVerificationError) {
      return jsonError(error.message, error.status);
    }

    throw error;
  }
});
