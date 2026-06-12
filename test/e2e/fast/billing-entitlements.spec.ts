import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import { and, eq, isNull } from "drizzle-orm";
import { test, expect } from "../fixtures";
import {
  inventoryLotBalances,
  organization,
  pricingSchedules,
} from "../../../lib/db/schema";
import {
  assertFeatureAccessInTx,
  getFeatureAccessInTx,
} from "../../../lib/billing/entitlements";
import { withOrgContext } from "../../../lib/db/with-org-context";
import {
  createCustomer,
  createItem,
  createPricingSchedule,
  getBaseUrl,
  getSessionCookie,
  getUnitId,
  testFetch,
} from "../../helpers/api";

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

test("lot tracking gates shadow-allow workflows and lock only when enforced", async ({
  db,
}) => {
  // Route level: a lot disposition under the unentitled test-org succeeds in
  // shadow mode (the default — no BILLING_ENFORCED_PLUGINS on the server).
  const ts = Date.now();
  const item = await createItem({
    itemType: "material",
    name: `Entitlement Lot Probe ${ts}`,
    unitDefinitionId: getUnitId(),
    sku: `ENT-LOT-PROBE-${ts}`,
    category: `Entitlement Probe ${ts}`,
    description: null,
    defaultPurchasePrice: "2.00",
    defaultSellingPrice: null,
    stock: "3",
    safetyStock: "0",
    bom: [],
  });
  expect(item.status).toBe(201);
  const itemId = (item.body as { id: string }).id;

  const lotsResponse = await testFetch(`/api/items/${itemId}/lots`);
  expect(lotsResponse.status).toBe(200);
  const [lot] = (await lotsResponse.json()) as Array<{ id: string }>;
  expect(lot).toBeTruthy();

  const disposition = await testFetch(
    `/api/items/${itemId}/lots/${lot.id}/disposition`,
    {
      method: "POST",
      body: JSON.stringify({
        action: "block",
        fromDisposition: "available",
        quantity: "1",
        notes: null,
      }),
    }
  );
  expect(disposition.status, await disposition.text()).toBe(200);

  const [blocked] = await db
    .select({ quantity: inventoryLotBalances.quantity })
    .from(inventoryLotBalances)
    .where(
      and(
        eq(inventoryLotBalances.lotId, lot.id),
        eq(inventoryLotBalances.disposition, "blocked")
      )
    );
  expect(Number(blocked?.quantity)).toBe(1);

  // Gate decision: enforcement (in-process env) locks an unentitled
  // post-launch org, entitlement unlocks it, downgrade re-locks it.
  const id = randomUUID();
  const orgId = `entitlement-lot-${id}`;
  await db.insert(organization).values({
    id: orgId,
    name: `Entitlement Lot ${id}`,
    slug: `entitlement-lot-${id}`,
    createdAt: new Date(),
    plan: "free",
    status: "active",
  });

  const previousEnforced = process.env.BILLING_ENFORCED_PLUGINS;
  const previousLaunch = process.env.BILLING_ENFORCEMENT_LAUNCH_AT;
  process.env.BILLING_ENFORCED_PLUGINS = "lot_tracking";
  process.env.BILLING_ENFORCEMENT_LAUNCH_AT = "2020-01-01T00:00:00Z";
  try {
    await withOrgContext(orgId, async (tx) => {
      const locked = await getFeatureAccessInTx(tx, orgId, "lot_tracking");
      expect(locked).toMatchObject({ entitled: false, locked: true });
    });

    await db
      .update(organization)
      .set({ entitlements: ["lot_tracking"] })
      .where(eq(organization.id, orgId));

    await withOrgContext(orgId, async (tx) => {
      const entitled = await getFeatureAccessInTx(tx, orgId, "lot_tracking");
      expect(entitled).toMatchObject({ entitled: true, locked: false });
    });

    await db
      .update(organization)
      .set({ entitlements: [] })
      .where(eq(organization.id, orgId));

    await withOrgContext(orgId, async (tx) => {
      const relocked = await getFeatureAccessInTx(tx, orgId, "lot_tracking");
      expect(relocked).toMatchObject({ entitled: false, locked: true });
    });
  } finally {
    if (previousEnforced === undefined) {
      delete process.env.BILLING_ENFORCED_PLUGINS;
    } else {
      process.env.BILLING_ENFORCED_PLUGINS = previousEnforced;
    }
    if (previousLaunch === undefined) {
      delete process.env.BILLING_ENFORCEMENT_LAUNCH_AT;
    } else {
      process.env.BILLING_ENFORCEMENT_LAUNCH_AT = previousLaunch;
    }
  }
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

test("shadow mode keeps schedule pricing applied for unentitled orgs", async () => {
  // The wholesale computation gate keys off `locked`, never `entitled`: in
  // shadow, an unentitled org must still resolve schedule pricing. A
  // regression to entitlement-keyed resolution would silently change prices
  // before launch.
  const ts = Date.now();
  const product = await createItem({
    itemType: "product",
    name: `Shadow Pricing Probe ${ts}`,
    sellable: true,
    unitDefinitionId: getUnitId(),
    sku: `SHADOW-PRICE-${ts}`,
    category: `Entitlement Probe ${ts}`,
    description: null,
    defaultPurchasePrice: null,
    defaultSellingPrice: "20.00",
    stock: "0",
    safetyStock: "0",
    bom: [],
  });
  expect(product.status).toBe(201);
  const productId = (product.body as { id: string }).id;

  const schedule = await createPricingSchedule({
    name: `Shadow Pricing Probe ${ts}`,
    itemIds: [productId],
    breaks: [{ minQuantity: "1", discountPercent: "10" }],
  });
  expect(schedule.status).toBe(201);

  const customer = await createCustomer({ name: `Shadow Pricing Probe ${ts}` });
  expect(customer.status).toBe(201);

  const price = await testFetch("/api/sales-orders/price", {
    method: "POST",
    body: JSON.stringify({
      customerId: (customer.body as { id: string }).id,
      itemId: productId,
      quantity: "5",
    }),
  });
  expect(price.status).toBe(200);
  const pricing = (await price.json()) as {
    suggestedUnitPrice: string | null;
    pricingSourceType: string;
  };
  expect(Number(pricing.suggestedUnitPrice)).toBe(18);
  expect(pricing.pricingSourceType).toBe("schedule_break");
});
