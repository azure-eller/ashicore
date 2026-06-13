import "server-only";

import { env } from "@/lib/env";

export function isStripeConfigured() {
  return Boolean(env.STRIPE_SECRET_KEY?.trim());
}

export function isCheckoutConfigured() {
  return isStripeConfigured() && env.STRIPE_CATALOG_READY === "1";
}
