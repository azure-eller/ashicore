// Creates the Stripe products/prices for the billing catalog, keyed by lookup
// key. Idempotent: existing lookup keys are left untouched, so it is safe to
// re-run after adding offers to BILLING_CATALOG.
//
//   STRIPE_SECRET_KEY=sk_test_... pnpm tsx scripts/stripe-create-catalog.ts
//
// Run once against test mode, then once against live before launch. After the
// target Stripe account has all catalog prices, set STRIPE_CATALOG_READY=1 for
// that deployment. The webhook resolves subscriptions back to plugins purely by
// lookup key, so no price IDs need to be recorded anywhere.
import Stripe from "stripe";
import { BILLING_CATALOG } from "../lib/billing/types";

async function main() {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) {
    console.error("Set STRIPE_SECRET_KEY (test or live) before running.");
    process.exit(1);
  }

  const stripe = new Stripe(secretKey);
  const mode = secretKey.startsWith("sk_live") ? "LIVE" : "test";
  console.log(`Creating catalog prices in ${mode} mode…`);

  const existing = await stripe.prices.list({
    lookup_keys: BILLING_CATALOG.map((offer) => offer.lookupKey),
    active: true,
    limit: 100,
  });
  const existingKeys = new Set(
    existing.data.map((price) => price.lookup_key).filter(Boolean)
  );

  for (const offer of BILLING_CATALOG) {
    if (existingKeys.has(offer.lookupKey)) {
      console.log(`= ${offer.lookupKey} already exists, skipping`);
      continue;
    }

    const product = await stripe.products.create({
      name: offer.name,
      description: offer.blurb,
      metadata: { lookupKey: offer.lookupKey, kind: offer.kind },
    });
    await stripe.prices.create({
      product: product.id,
      currency: "usd",
      unit_amount: offer.monthlyUsd * 100,
      recurring: { interval: "month" },
      lookup_key: offer.lookupKey,
      transfer_lookup_key: true,
    });
    console.log(`+ ${offer.lookupKey} → ${offer.name} $${offer.monthlyUsd}/mo`);
  }

  console.log("Done. Set STRIPE_CATALOG_READY=1 for this deployment.");
}

void main();
