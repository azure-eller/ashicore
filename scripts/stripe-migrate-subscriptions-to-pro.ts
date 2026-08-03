// Previews or applies the one-time move from legacy recurring catalog items to
// the flat $199/month Pro price. Same-interval subscriptions keep their billing
// cycle and create no prorations. Interval changes require manual scheduling at
// the current period end so Stripe cannot charge the customer immediately.
//
//   STRIPE_SECRET_KEY=sk_test_... pnpm tsx scripts/stripe-migrate-subscriptions-to-pro.ts
//   STRIPE_SECRET_KEY=sk_live_... pnpm tsx scripts/stripe-migrate-subscriptions-to-pro.ts --apply
import Stripe from "stripe";
import { getBillingOffer, PRO_PLAN_LOOKUP_KEY } from "../lib/billing/types";

const APPLY = process.argv.includes("--apply");
const MIGRATABLE_STATUSES = new Set<Stripe.Subscription.Status>([
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "paused",
]);

async function main() {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) throw new Error("Set STRIPE_SECRET_KEY before running.");

  const stripe = new Stripe(secretKey);
  const [proPrice] = (
    await stripe.prices.list({
      lookup_keys: [PRO_PLAN_LOOKUP_KEY],
      active: true,
      limit: 1,
    })
  ).data;
  if (!proPrice) {
    throw new Error(`Active Stripe price ${PRO_PLAN_LOOKUP_KEY} was not found.`);
  }

  let inspected = 0;
  let eligible = 0;
  let changed = 0;
  let manualReview = 0;

  for await (const subscription of stripe.subscriptions.list({ status: "all", limit: 100 })) {
    inspected += 1;
    if (!MIGRATABLE_STATUSES.has(subscription.status)) continue;

    const knownItems = subscription.items.data.filter((item) => {
      const lookupKey = item.price.lookup_key;
      return lookupKey != null && getBillingOffer(lookupKey) != null;
    });
    if (knownItems.length === 0) continue;

    if (knownItems.length !== subscription.items.data.length) {
      manualReview += 1;
      console.warn(
        `MANUAL REVIEW ${subscription.id}: mixed catalog items ${subscription.items.data
          .map((item) => item.price.lookup_key ?? item.price.id)
          .join(", ")}`,
      );
      continue;
    }

    const alreadyFlatPro =
      knownItems.length === 1 &&
      knownItems[0].price.lookup_key === PRO_PLAN_LOOKUP_KEY &&
      subscription.items.data.length === 1;
    if (alreadyFlatPro) continue;

    const changesBillingInterval = knownItems.some(
      (item) =>
        item.price.recurring?.interval !== proPrice.recurring?.interval ||
        item.price.recurring?.interval_count !== proPrice.recurring?.interval_count,
    );
    if (changesBillingInterval) {
      manualReview += 1;
      console.warn(
        `MANUAL REVIEW ${subscription.id}: changing ${subscription.items.data
          .map((item) => {
            const recurring = item.price.recurring;
            return `${item.price.lookup_key ?? item.price.id} (${recurring?.interval_count ?? 1} ${recurring?.interval ?? "non-recurring"})`;
          })
          .join(", ")} to ${PRO_PLAN_LOOKUP_KEY} would reset the billing cycle and can charge immediately; schedule the change for the current period end in Stripe`,
      );
      continue;
    }

    eligible += 1;
    console.log(
      `${APPLY ? "MIGRATE" : "WOULD MIGRATE"} ${subscription.id}: ${subscription.items.data
        .map((item) => item.price.lookup_key ?? item.price.id)
        .join(", ")} -> ${PRO_PLAN_LOOKUP_KEY}`,
    );

    if (!APPLY) continue;
    await stripe.subscriptions.update(subscription.id, {
      items: [
        ...subscription.items.data.map((item) => ({ id: item.id, deleted: true as const })),
        { price: proPrice.id, quantity: 1 },
      ],
      proration_behavior: "none",
      metadata: {
        ...subscription.metadata,
        pricingMigration: "free-pro-199",
      },
    });
    changed += 1;
  }

  console.log(
    `${APPLY ? "Applied" : "Previewed"}: inspected ${inspected}, eligible ${eligible}, changed ${changed}, manual review ${manualReview}.`,
  );
  if (!APPLY && eligible > 0) console.log("Re-run with --apply after reviewing this list.");
}

void main();
