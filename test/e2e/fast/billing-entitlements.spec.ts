import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import { and, eq, isNull } from "drizzle-orm";
import { test, expect } from "../fixtures";
import { organization, pricingSchedules } from "../../../lib/db/schema";
import { assertFeatureAccessInTx } from "../../../lib/billing/entitlements";
import { withOrgContext } from "../../../lib/db/with-org-context";
import { getBaseUrl, getSessionCookie } from "../../helpers/api";

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? "";

function subscriptionEventBody({
  customerId,
  orgId,
  subscriptionId,
  type,
  status,
  lookupKeys,
}: {
  customerId: string;
  orgId: string;
  subscriptionId: string;
  type: "customer.subscription.updated" | "customer.subscription.deleted";
  status: string;
  lookupKeys: string[];
}) {
  const periodEnd = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
  return JSON.stringify({
    id: `evt_${randomUUID().replaceAll("-", "")}`,
    object: "event",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    type,
    data: {
      object: {
        id: subscriptionId,
        object: "subscription",
        customer: customerId,
        status,
        cancel_at_period_end: false,
        metadata: { organizationId: orgId },
        items: {
          object: "list",
          data: lookupKeys.map((lookupKey, index) => ({
            id: `si_${index}`,
            object: "subscription_item",
            current_period_end: periodEnd,
            price: { id: `price_${lookupKey}`, object: "price", lookup_key: lookupKey },
          })),
        },
      },
    },
  });
}

// Signed with the same secret the dev server holds; the fake STRIPE_SECRET_KEY
// makes subscriptions.retrieve fail, exercising the documented event-payload
// fallback in handleStripeWebhook.
async function postSignedWebhook(body: string) {
  const signature = Stripe.webhooks.generateTestHeaderString({
    payload: body,
    secret: WEBHOOK_SECRET,
  });

  return fetch(`${getBaseUrl()}/api/stripe/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": signature },
    body,
  });
}

test.beforeAll(() => {
  if (!WEBHOOK_SECRET) {
    throw new Error(
      "STRIPE_WEBHOOK_SECRET must be set for the billing entitlement seam (CI sets a fake test value)."
    );
  }
});

test("stripe webhook is the single writer of the org plugin entitlement set", async ({
  db,
}) => {
  const id = randomUUID();
  const orgId = `entitlement-fast-${id}`;
  const customerId = `cus_entfast_${id.replaceAll("-", "")}`;
  const subscriptionId = `sub_entfast_${id.replaceAll("-", "")}`;

  await db.insert(organization).values({
    id: orgId,
    name: `Entitlement Fast ${id}`,
    slug: `entitlement-fast-${id}`,
    createdAt: new Date(),
    plan: "free",
    status: "active",
    stripeCustomerId: customerId,
  });

  const grant = await postSignedWebhook(
    subscriptionEventBody({
      customerId,
      orgId,
      subscriptionId,
      type: "customer.subscription.updated",
      status: "active",
      lookupKeys: ["package_food_bev", "plugin_crm", "unknown_price_key"],
    })
  );
  expect(grant.ok).toBe(true);

  const [granted] = await db
    .select({
      plan: organization.plan,
      entitlements: organization.entitlements,
      stripeSubscriptionId: organization.stripeSubscriptionId,
    })
    .from(organization)
    .where(eq(organization.id, orgId))
    .limit(1);

  expect(granted.entitlements).toEqual([
    "lot_tracking",
    "batch_production",
    "planning",
    "crm",
  ]);
  expect(granted.plan).toBe("core");
  expect(granted.stripeSubscriptionId).toBe(subscriptionId);

  const staleRevoke = await postSignedWebhook(
    subscriptionEventBody({
      customerId,
      orgId,
      subscriptionId: `sub_stale_${id.replaceAll("-", "")}`,
      type: "customer.subscription.deleted",
      status: "canceled",
      lookupKeys: ["plugin_wholesale_pricing"],
    })
  );
  expect(staleRevoke.ok).toBe(true);

  const [stillGranted] = await db
    .select({
      plan: organization.plan,
      status: organization.status,
      entitlements: organization.entitlements,
      stripeSubscriptionId: organization.stripeSubscriptionId,
    })
    .from(organization)
    .where(eq(organization.id, orgId))
    .limit(1);

  expect(stillGranted.entitlements).toEqual([
    "lot_tracking",
    "batch_production",
    "planning",
    "crm",
  ]);
  expect(stillGranted.plan).toBe("core");
  expect(stillGranted.status).toBe("active");
  expect(stillGranted.stripeSubscriptionId).toBe(subscriptionId);

  const revoke = await postSignedWebhook(
    subscriptionEventBody({
      customerId,
      orgId,
      subscriptionId,
      type: "customer.subscription.deleted",
      status: "canceled",
      lookupKeys: ["package_food_bev"],
    })
  );
  expect(revoke.ok).toBe(true);

  const [revoked] = await db
    .select({
      plan: organization.plan,
      status: organization.status,
      entitlements: organization.entitlements,
      stripeSubscriptionId: organization.stripeSubscriptionId,
    })
    .from(organization)
    .where(eq(organization.id, orgId))
    .limit(1);

  expect(revoked.entitlements).toEqual([]);
  expect(revoked.plan).toBe("free");
  expect(revoked.status).toBe("canceled");
  expect(revoked.stripeSubscriptionId).toBeNull();
});

test("feature gates shadow-log unentitled orgs and recognize entitled ones", async ({
  db,
}) => {
  const id = randomUUID();
  const orgId = `entitlement-gate-${id}`;

  await db.insert(organization).values({
    id: orgId,
    name: `Entitlement Gate ${id}`,
    slug: `entitlement-gate-${id}`,
    createdAt: new Date(),
    plan: "free",
    status: "active",
  });

  await withOrgContext(orgId, async (tx) => {
    const denied = await assertFeatureAccessInTx(tx, orgId, "wholesale_pricing");
    expect(denied.allowed).toBe(true);
    expect(denied.entitled).toBe(false);
    expect(denied.shadowDenial).toBe(true);
    expect(denied.failedOpen).toBe(false);
  });

  await db
    .update(organization)
    .set({ entitlements: ["wholesale_pricing"] })
    .where(eq(organization.id, orgId));

  await withOrgContext(orgId, async (tx) => {
    const entitled = await assertFeatureAccessInTx(tx, orgId, "wholesale_pricing");
    expect(entitled.entitled).toBe(true);
    expect(entitled.shadowDenial).toBe(false);
  });
});

test("shadow mode never blocks a gated mutation for an unentitled org", async ({
  db,
}) => {
  // The org-wide all-customers/all-items slot is unique; clear it so reruns pass.
  await db
    .update(pricingSchedules)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(pricingSchedules.itemScope, "all"),
        isNull(pricingSchedules.customerCategoryId),
        isNull(pricingSchedules.deletedAt)
      )
    );

  const response = await fetch(`${getBaseUrl()}/api/pricing-schedules`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: getSessionCookie(),
    },
    body: JSON.stringify({
      name: `Fast Entitlement Probe ${Date.now()}`,
      customerCategoryId: null,
      notes: null,
      itemScope: "all",
      itemCategory: null,
      itemVariantOptionCode: null,
      itemVariantValueCode: null,
      itemIds: [],
      breaks: [{ minQuantity: "1", maxQuantity: null, discountPercent: "10" }],
    }),
  });

  expect(response.status).toBe(201);
  const schedule = (await response.json()) as { id: string };

  const [row] = await db
    .select({ id: pricingSchedules.id })
    .from(pricingSchedules)
    .where(eq(pricingSchedules.id, schedule.id))
    .limit(1);
  expect(row?.id).toBe(schedule.id);
});
