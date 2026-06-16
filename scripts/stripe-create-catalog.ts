// Creates the Stripe products/prices for the billing catalog, keyed by lookup
// key. Idempotent: existing lookup keys are left untouched, so it is safe to
// re-run after adding offers to STRIPE_BILLING_CATALOG.
//
//   STRIPE_SECRET_KEY=sk_test_... pnpm tsx scripts/stripe-create-catalog.ts
//
// Run once against test mode, then once against live before launch. After the
// target Stripe account has all catalog prices, set STRIPE_CATALOG_READY=1 for
// that deployment. The webhook resolves subscriptions back to plugins purely by
// lookup key, so no price IDs need to be recorded anywhere.
import Stripe from "stripe";
import {
  EXTRA_LOCATION_LOOKUP_KEY,
  STRIPE_BILLING_CATALOG,
  canonicalRecurringLookupKey,
} from "../lib/billing/types";

function extraLocationUnitAmount(position: number, annual: boolean) {
  const monthlyUsd = Math.max(40 - 2 * (position - 1), 24);
  return monthlyUsd * (annual ? 10 : 1) * 100;
}

function extraLocationTiers(annual: boolean): Stripe.PriceCreateParams.Tier[] {
  return [
    ...Array.from({ length: 8 }, (_, index) => ({
      up_to: index + 1,
      unit_amount: extraLocationUnitAmount(index + 1, annual),
    })),
    { up_to: "inf" as const, unit_amount: extraLocationUnitAmount(9, annual) },
  ];
}

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
    lookup_keys: STRIPE_BILLING_CATALOG.map((offer) => offer.lookupKey),
    active: true,
    limit: 100,
  });
  const existingKeys = new Set(
    existing.data.map((price) => price.lookup_key).filter(Boolean)
  );

  for (const offer of STRIPE_BILLING_CATALOG) {
    if (existingKeys.has(offer.lookupKey)) {
      console.log(`= ${offer.lookupKey} already exists, skipping`);
      continue;
    }

    const product = await stripe.products.create({
      name: offer.name,
      description: offer.blurb,
      metadata: {
        lookupKey: offer.lookupKey,
        kind: offer.kind,
        interval: offer.interval ?? "monthly",
        salesOrderBand: offer.salesOrderBand ?? "",
      },
    });
    const interval = offer.interval === "annual" ? "year" : "month";
    const isAnnual = offer.interval === "annual";
    const isCore = offer.kind === "core";
    const isExtraLocation =
      canonicalRecurringLookupKey(offer.lookupKey) === EXTRA_LOCATION_LOOKUP_KEY;
    const priceParams: Stripe.PriceCreateParams = {
      product: product.id,
      currency: "usd",
      recurring: { interval },
      lookup_key: offer.lookupKey,
      transfer_lookup_key: true,
    };

    if (isExtraLocation) {
      priceParams.billing_scheme = "tiered";
      priceParams.tiers_mode = "graduated";
      priceParams.tiers = extraLocationTiers(isAnnual);
    } else {
      priceParams.unit_amount = offer.monthlyUsd * (isAnnual && !isCore ? 10 : 12) * 100;
      if (!isAnnual) {
        priceParams.unit_amount = offer.monthlyUsd * 100;
      }
    }

    await stripe.prices.create(priceParams);
    console.log(
      `+ ${offer.lookupKey} → ${offer.name} $${offer.monthlyUsd}/mo (${interval})`
    );
  }

  console.log("Done. Set STRIPE_CATALOG_READY=1 for this deployment.");
}

void main();
