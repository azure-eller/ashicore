import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import { and, asc, eq, isNull } from "drizzle-orm";
import { test, expect } from "../fixtures";
import {
  billingPeriodAdjustments,
  billingUsageEvents,
  customers,
  inventoryLocations,
  inventoryLotBalances,
  organization,
  pricingSchedules,
  salesOrders,
} from "../../../lib/db/schema";
import { recordSalesOrderShippedUsageInTx } from "../../../lib/billing/buckets";
import {
  asBillingAddonLookupKeys,
  billingLineItemsForCoreSelection,
  salesOrderBandDeltaCents,
} from "../../../lib/billing/types";
import {
  billingIntentEntitlementsMet,
  billingIntentToCommercialSelection,
  normalizeBillingIntent,
} from "../../../lib/billing/plan-intent";
import {
  assertLocationCapacityInTx,
  assertSalesOrderCapacityInTx,
  BillingCapacityError,
  assertFeatureAccessInTx,
  getFeatureAccessInTx,
  getBillingOverviewInTx,
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
  quantities = {},
}: {
  customerId: string;
  orgId: string;
  subscriptionId: string;
  type: "customer.subscription.updated" | "customer.subscription.deleted";
  status: string;
  lookupKeys: string[];
  quantities?: Record<string, number>;
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
            quantity: quantities[lookupKey] ?? 1,
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

test("annual bucket deltas charge the annual period difference", () => {
  expect(
    salesOrderBandDeltaCents({
      from: "starter",
      to: "growth",
      interval: "annual",
    })
  ).toBe(100800);
});

test("calculator billing intent preserves band interval locations and add-ons", () => {
  const intent = normalizeBillingIntent({
    plan: "core_growth_annual",
    locations: "3",
    addons: "package_food_bev,plugin_crm",
  });

  expect(billingIntentToCommercialSelection(intent)).toEqual({
    mode: "core",
    band: "growth",
    interval: "annual",
    locationCapacity: 3,
    addonLookupKeys: ["plugin_crm", "package_food_bev"],
  });
  expect(
    billingIntentEntitlementsMet(intent, {
      plan: "core",
      status: "active",
      locationCapacity: 3,
      entitlements: [
        "lot_tracking",
        "batch_production",
        "crm",
        "wholesale_pricing",
      ],
    })
  ).toBe(true);
});

test("legacy package billing intent preserves selected package add-on", () => {
  const intent = normalizeBillingIntent({
    plan: "package_soil_landscape",
    addons: "plugin_crm",
  });

  expect(billingIntentToCommercialSelection(intent)).toEqual({
    mode: "core",
    band: "starter",
    interval: "monthly",
    locationCapacity: 1,
    addonLookupKeys: ["plugin_crm", "package_soil_landscape"],
  });
  expect(
    billingIntentEntitlementsMet(intent, {
      plan: "core",
      status: "active",
      locationCapacity: 1,
      entitlements: ["crm"],
    })
  ).toBe(false);
  expect(
    billingIntentEntitlementsMet(intent, {
      plan: "core",
      status: "active",
      locationCapacity: 1,
      entitlements: [
        "batch_production",
        "crm",
        "multi_location",
        "wholesale_pricing",
      ],
    })
  ).toBe(true);
});

test("annual Core selections use annual Stripe prices for recurring add-ons", () => {
  expect(
    billingLineItemsForCoreSelection({
      mode: "core",
      band: "growth",
      interval: "annual",
      locationCapacity: 3,
      addonLookupKeys: ["package_food_bev", "plugin_crm"],
    })
  ).toEqual([
    { lookupKey: "core_growth_annual", quantity: 1 },
    { lookupKey: "extra_location_annual", quantity: 2 },
    { lookupKey: "plugin_crm_annual", quantity: 1 },
    { lookupKey: "package_food_bev_annual", quantity: 1 },
  ]);

  expect(
    asBillingAddonLookupKeys(["package_food_bev_annual", "plugin_crm_annual"])
  ).toEqual(["plugin_crm", "package_food_bev"]);
});

test("scale Core selections require sales-assisted pricing", () => {
  expect(() =>
    billingLineItemsForCoreSelection({
      mode: "core",
      band: "scale",
      interval: "annual",
    })
  ).toThrow("Scale Core requires sales-assisted pricing.");
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
      lookupKeys: [
        "core_growth_annual",
        "extra_location_annual",
        "package_food_bev_annual",
        "plugin_crm_annual",
        "unknown_price_key",
      ],
      quantities: { extra_location_annual: 2 },
    })
  );
  expect(grant.ok).toBe(true);

  const [granted] = await db
    .select({
      plan: organization.plan,
      billingInterval: organization.billingInterval,
      salesOrderBand: organization.salesOrderBand,
      locationCapacity: organization.locationCapacity,
      billingAddons: organization.billingAddons,
      entitlements: organization.entitlements,
      stripeSubscriptionId: organization.stripeSubscriptionId,
    })
    .from(organization)
    .where(eq(organization.id, orgId))
    .limit(1);

  expect(granted.entitlements).toEqual([
    "lot_tracking",
    "batch_production",
    "crm",
    "wholesale_pricing",
  ]);
  expect(granted.plan).toBe("core");
  expect(granted.billingInterval).toBe("annual");
  expect(granted.salesOrderBand).toBe("growth");
  expect(granted.locationCapacity).toBe(3);
  expect(granted.billingAddons).toEqual(["plugin_crm", "package_food_bev"]);
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
      billingInterval: organization.billingInterval,
      salesOrderBand: organization.salesOrderBand,
      locationCapacity: organization.locationCapacity,
      billingAddons: organization.billingAddons,
      entitlements: organization.entitlements,
      stripeSubscriptionId: organization.stripeSubscriptionId,
    })
    .from(organization)
    .where(eq(organization.id, orgId))
    .limit(1);

  expect(stillGranted.entitlements).toEqual([
    "lot_tracking",
    "batch_production",
    "crm",
    "wholesale_pricing",
  ]);
  expect(stillGranted.plan).toBe("core");
  expect(stillGranted.status).toBe("active");
  expect(stillGranted.billingInterval).toBe("annual");
  expect(stillGranted.salesOrderBand).toBe("growth");
  expect(stillGranted.locationCapacity).toBe(3);
  expect(stillGranted.billingAddons).toEqual(["plugin_crm", "package_food_bev"]);
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
      billingInterval: organization.billingInterval,
      salesOrderBand: organization.salesOrderBand,
      locationCapacity: organization.locationCapacity,
      billingAddons: organization.billingAddons,
      entitlements: organization.entitlements,
      stripeSubscriptionId: organization.stripeSubscriptionId,
    })
    .from(organization)
    .where(eq(organization.id, orgId))
    .limit(1);

  expect(revoked.entitlements).toEqual([]);
  expect(revoked.plan).toBe("trial");
  expect(revoked.status).toBe("canceled");
  expect(revoked.billingInterval).toBe("monthly");
  expect(revoked.salesOrderBand).toBe("starter");
  expect(revoked.locationCapacity).toBe(1);
  expect(revoked.billingAddons).toEqual([]);
  expect(revoked.stripeSubscriptionId).toBeNull();
});

test("location capacity blocks a second paid location when the org has no room", async ({
  db,
}) => {
  const id = randomUUID();
  const orgId = `capacity-location-${id}`;

  await db.insert(organization).values({
    id: orgId,
    name: `Capacity Location ${id}`,
    slug: `capacity-location-${id}`,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    plan: "core",
    status: "active",
    locationCapacity: 1,
  });
  await withOrgContext(orgId, async (tx) => {
    await tx.insert(inventoryLocations).values({
      organizationId: orgId,
      name: "Main",
      code: "MAIN",
      isDefault: true,
    });
  });

  const previousEnforced = process.env.BILLING_ENTITLEMENTS_ENFORCED;
  const previousEnforcedPlugins = process.env.BILLING_ENFORCED_PLUGINS;
  const previousLaunchAt = process.env.BILLING_ENFORCEMENT_LAUNCH_AT;
  process.env.BILLING_ENTITLEMENTS_ENFORCED = "1";
  process.env.BILLING_ENFORCED_PLUGINS = "multi_location";
  process.env.BILLING_ENFORCEMENT_LAUNCH_AT = "2025-01-01T00:00:00Z";
  try {
    await withOrgContext(orgId, async (tx) => {
      await expect(
        assertLocationCapacityInTx(tx, orgId, { route: "/api/locations" })
      ).rejects.toBeInstanceOf(BillingCapacityError);
    });
  } finally {
    if (previousEnforced === undefined) {
      delete process.env.BILLING_ENTITLEMENTS_ENFORCED;
    } else {
      process.env.BILLING_ENTITLEMENTS_ENFORCED = previousEnforced;
    }
    if (previousEnforcedPlugins === undefined) {
      delete process.env.BILLING_ENFORCED_PLUGINS;
    } else {
      process.env.BILLING_ENFORCED_PLUGINS = previousEnforcedPlugins;
    }
    if (previousLaunchAt === undefined) {
      delete process.env.BILLING_ENFORCEMENT_LAUNCH_AT;
    } else {
      process.env.BILLING_ENFORCEMENT_LAUNCH_AT = previousLaunchAt;
    }
  }
});

test("multi-location entitlement does not bypass purchased location capacity", async ({
  db,
}) => {
  const id = randomUUID();
  const orgId = `capacity-entitlement-${id}`;

  await db.insert(organization).values({
    id: orgId,
    name: `Capacity Entitlement ${id}`,
    slug: `capacity-entitlement-${id}`,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    plan: "core",
    status: "active",
    locationCapacity: 1,
    entitlements: ["multi_location"],
  });
  await withOrgContext(orgId, async (tx) => {
    await tx.insert(inventoryLocations).values({
      organizationId: orgId,
      name: "Main",
      code: "MAIN",
      isDefault: true,
    });
  });

  const previousEnforced = process.env.BILLING_ENTITLEMENTS_ENFORCED;
  const previousEnforcedPlugins = process.env.BILLING_ENFORCED_PLUGINS;
  const previousLaunchAt = process.env.BILLING_ENFORCEMENT_LAUNCH_AT;
  process.env.BILLING_ENTITLEMENTS_ENFORCED = "1";
  process.env.BILLING_ENFORCED_PLUGINS = "multi_location";
  process.env.BILLING_ENFORCEMENT_LAUNCH_AT = "2025-01-01T00:00:00Z";
  try {
    await withOrgContext(orgId, async (tx) => {
      await expect(
        assertLocationCapacityInTx(tx, orgId, { route: "/api/locations" })
      ).rejects.toBeInstanceOf(BillingCapacityError);
    });
  } finally {
    if (previousEnforced === undefined) {
      delete process.env.BILLING_ENTITLEMENTS_ENFORCED;
    } else {
      process.env.BILLING_ENTITLEMENTS_ENFORCED = previousEnforced;
    }
    if (previousEnforcedPlugins === undefined) {
      delete process.env.BILLING_ENFORCED_PLUGINS;
    } else {
      process.env.BILLING_ENFORCED_PLUGINS = previousEnforcedPlugins;
    }
    if (previousLaunchAt === undefined) {
      delete process.env.BILLING_ENFORCEMENT_LAUNCH_AT;
    } else {
      process.env.BILLING_ENFORCEMENT_LAUNCH_AT = previousLaunchAt;
    }
  }
});

test("capacity gates shadow-allow grandfathered orgs and block post-launch expired trials", async ({
  db,
}) => {
  const id = randomUUID();
  const grandfatheredOrgId = `grandfathered-location-${id}`;
  const expiredTrialOrgId = `expired-trial-${id}`;

  await db.insert(organization).values([
    {
      id: grandfatheredOrgId,
      name: `Grandfathered Location ${id}`,
      slug: `grandfathered-location-${id}`,
      createdAt: new Date("2024-01-01T00:00:00Z"),
      plan: "core",
      status: "active",
      locationCapacity: 1,
    },
    {
      id: expiredTrialOrgId,
      name: `Expired Trial ${id}`,
      slug: `expired-trial-${id}`,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      trialEndsAt: new Date("2026-01-15T00:00:00Z"),
      plan: "trial",
      status: "active",
    },
  ]);

  await withOrgContext(grandfatheredOrgId, async (tx) => {
    await tx.insert(inventoryLocations).values({
      organizationId: grandfatheredOrgId,
      name: "Main",
      code: "MAIN",
      isDefault: true,
    });
  });

  const previousEnforced = process.env.BILLING_ENTITLEMENTS_ENFORCED;
  const previousEnforcedPlugins = process.env.BILLING_ENFORCED_PLUGINS;
  const previousLaunchAt = process.env.BILLING_ENFORCEMENT_LAUNCH_AT;
  process.env.BILLING_ENTITLEMENTS_ENFORCED = "1";
  process.env.BILLING_ENFORCED_PLUGINS = "multi_location";
  process.env.BILLING_ENFORCEMENT_LAUNCH_AT = "2025-01-01T00:00:00Z";
  try {
    await withOrgContext(grandfatheredOrgId, async (tx) => {
      await expect(
        assertLocationCapacityInTx(tx, grandfatheredOrgId, {
          route: "/api/locations",
        })
      ).resolves.toEqual({ allowed: true, failedOpen: false });
    });

    await withOrgContext(expiredTrialOrgId, async (tx) => {
      await expect(
        assertSalesOrderCapacityInTx(tx, expiredTrialOrgId, {
          route: "/api/sales-orders",
        })
      ).rejects.toBeInstanceOf(BillingCapacityError);
    });
  } finally {
    if (previousEnforced === undefined) {
      delete process.env.BILLING_ENTITLEMENTS_ENFORCED;
    } else {
      process.env.BILLING_ENTITLEMENTS_ENFORCED = previousEnforced;
    }
    if (previousEnforcedPlugins === undefined) {
      delete process.env.BILLING_ENFORCED_PLUGINS;
    } else {
      process.env.BILLING_ENFORCED_PLUGINS = previousEnforcedPlugins;
    }
    if (previousLaunchAt === undefined) {
      delete process.env.BILLING_ENFORCEMENT_LAUNCH_AT;
    } else {
      process.env.BILLING_ENFORCEMENT_LAUNCH_AT = previousLaunchAt;
    }
  }
});

test("stripe add-on-only subscriptions grant add-ons without projecting Core", async ({
  db,
}) => {
  const id = randomUUID();
  const orgId = `addon-only-${id}`;
  const customerId = `cus_addon_${id.replaceAll("-", "")}`;
  const subscriptionId = `sub_addon_${id.replaceAll("-", "")}`;

  await db.insert(organization).values({
    id: orgId,
    name: `Addon Only ${id}`,
    slug: `addon-only-${id}`,
    createdAt: new Date(),
    plan: "trial",
    status: "active",
    stripeCustomerId: customerId,
  });

  const response = await postSignedWebhook(
    subscriptionEventBody({
      customerId,
      orgId,
      subscriptionId,
      type: "customer.subscription.updated",
      status: "active",
      lookupKeys: ["package_food_bev"],
    })
  );
  expect(response.ok).toBe(true);

  const [projected] = await db
    .select({
      plan: organization.plan,
      status: organization.status,
      billingAddons: organization.billingAddons,
      entitlements: organization.entitlements,
      stripeSubscriptionId: organization.stripeSubscriptionId,
    })
    .from(organization)
    .where(eq(organization.id, orgId))
    .limit(1);

  expect(projected.plan).toBe("trial");
  expect(projected.status).toBe("active");
  expect(projected.billingAddons).toEqual(["package_food_bev"]);
  expect(projected.entitlements).toEqual([
    "lot_tracking",
    "batch_production",
    "wholesale_pricing",
  ]);
  expect(projected.stripeSubscriptionId).toBe(subscriptionId);
});

test("shipped sales orders create idempotent usage events and bucket adjustments", async ({
  db,
}) => {
  const id = randomUUID();
  const orgId = `bucket-usage-${id}`;
  const periodStart = new Date("2026-06-01T00:00:00Z");
  const periodEnd = new Date("2026-07-01T00:00:00Z");

  await db.insert(organization).values({
    id: orgId,
    name: `Bucket Usage ${id}`,
    slug: `bucket-usage-${id}`,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    plan: "core",
    status: "active",
    salesOrderBand: "starter",
    billingInterval: "monthly",
    currentPeriodStart: periodStart,
    currentPeriodEnd: periodEnd,
  });

  const previousLaunchAt = process.env.BILLING_ENFORCEMENT_LAUNCH_AT;
  process.env.BILLING_ENFORCEMENT_LAUNCH_AT = "2025-01-01T00:00:00Z";
  try {
    await withOrgContext(orgId, async (tx) => {
      const [customer] = await tx
        .insert(customers)
        .values({
          organizationId: orgId,
          name: `Bucket Customer ${id}`,
        })
        .returning({ id: customers.id });

      for (let index = 0; index < 251; index += 1) {
        const [order] = await tx
          .insert(salesOrders)
          .values({
            organizationId: orgId,
            orderNumber: `BU-${index}`,
            customerId: customer.id,
            customerName: `Bucket Customer ${id}`,
            status: "done",
            shippedAt: new Date("2026-06-15T00:00:00Z"),
          })
          .returning({ id: salesOrders.id });

        await recordSalesOrderShippedUsageInTx(tx, {
          orgId,
          salesOrderId: order.id,
          occurredAt: new Date("2026-06-15T00:00:00Z"),
        });
      }

      const [lastOrder] = await tx
        .select({ id: salesOrders.id })
        .from(salesOrders)
        .where(eq(salesOrders.orderNumber, "BU-250"))
        .limit(1);
      await recordSalesOrderShippedUsageInTx(tx, {
        orgId,
        salesOrderId: lastOrder.id,
        occurredAt: new Date("2026-06-15T00:00:00Z"),
      });

      await tx.insert(billingPeriodAdjustments).values({
        organizationId: orgId,
        billingPeriodStart: periodStart,
        billingPeriodEnd: periodEnd,
        fromBand: "starter",
        toBand: "growth",
        amountCents: 10000,
        status: "pending",
        idempotencyKey: `bucket-adjustment:${orgId}:${periodStart.toISOString()}:starter:growth:duplicate`,
      }).onConflictDoNothing({
        target: [
          billingPeriodAdjustments.organizationId,
          billingPeriodAdjustments.billingPeriodStart,
          billingPeriodAdjustments.toBand,
        ],
      });
    });
  } finally {
    if (previousLaunchAt === undefined) {
      delete process.env.BILLING_ENFORCEMENT_LAUNCH_AT;
    } else {
      process.env.BILLING_ENFORCEMENT_LAUNCH_AT = previousLaunchAt;
    }
  }

  const usageRows = await withOrgContext(orgId, (tx) =>
    tx
      .select({ id: billingUsageEvents.id })
      .from(billingUsageEvents)
      .where(eq(billingUsageEvents.organizationId, orgId))
  );
  expect(usageRows).toHaveLength(251);

  const adjustments = await withOrgContext(orgId, (tx) =>
    tx
      .select({
        fromBand: billingPeriodAdjustments.fromBand,
        toBand: billingPeriodAdjustments.toBand,
        amountCents: billingPeriodAdjustments.amountCents,
        status: billingPeriodAdjustments.status,
      })
      .from(billingPeriodAdjustments)
      .where(eq(billingPeriodAdjustments.organizationId, orgId))
      .orderBy(
        asc(billingPeriodAdjustments.createdAt),
        asc(billingPeriodAdjustments.toBand)
      )
  );
  expect(adjustments).toEqual([
    {
      fromBand: "starter",
      toBand: "growth",
      amountCents: 10000,
      status: "pending",
    },
    {
      fromBand: "growth",
      toBand: "pro",
      amountCents: 15000,
      status: "pending",
    },
  ]);
});

test("annual Core bucket usage counts monthly and charges a band once per annual period", async ({
  db,
}) => {
  const id = randomUUID();
  const orgId = `annual-bucket-usage-${id}`;
  const periodStart = new Date("2026-01-01T00:00:00Z");
  const periodEnd = new Date("2027-01-01T00:00:00Z");

  await db.insert(organization).values({
    id: orgId,
    name: `Annual Bucket Usage ${id}`,
    slug: `annual-bucket-usage-${id}`,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    plan: "core",
    status: "active",
    salesOrderBand: "starter",
    billingInterval: "annual",
    currentPeriodStart: periodStart,
    currentPeriodEnd: periodEnd,
  });

  const previousLaunchAt = process.env.BILLING_ENFORCEMENT_LAUNCH_AT;
  process.env.BILLING_ENFORCEMENT_LAUNCH_AT = "2025-01-01T00:00:00Z";
  try {
    await withOrgContext(orgId, async (tx) => {
      const [customer] = await tx
        .insert(customers)
        .values({
          organizationId: orgId,
          name: `Annual Bucket Customer ${id}`,
        })
        .returning({ id: customers.id });

      for (const [month, occurredAt, orderCount] of [
        ["JUN", new Date("2026-06-15T00:00:00Z"), 101],
        ["JUL", new Date("2026-07-15T00:00:00Z"), 251],
      ] as const) {
        for (let index = 0; index < orderCount; index += 1) {
          const [order] = await tx
            .insert(salesOrders)
            .values({
              organizationId: orgId,
              orderNumber: `${month}-${index}`,
              customerId: customer.id,
              customerName: `Annual Bucket Customer ${id}`,
              status: "done",
              shippedAt: occurredAt,
            })
            .returning({ id: salesOrders.id });

          await recordSalesOrderShippedUsageInTx(tx, {
            orgId,
            salesOrderId: order.id,
            occurredAt,
          });
        }
      }
    });
  } finally {
    if (previousLaunchAt === undefined) {
      delete process.env.BILLING_ENFORCEMENT_LAUNCH_AT;
    } else {
      process.env.BILLING_ENFORCEMENT_LAUNCH_AT = previousLaunchAt;
    }
  }

  const adjustments = await withOrgContext(orgId, (tx) =>
    tx
      .select({
        billingPeriodStart: billingPeriodAdjustments.billingPeriodStart,
        billingPeriodEnd: billingPeriodAdjustments.billingPeriodEnd,
        fromBand: billingPeriodAdjustments.fromBand,
        toBand: billingPeriodAdjustments.toBand,
        amountCents: billingPeriodAdjustments.amountCents,
      })
      .from(billingPeriodAdjustments)
      .where(eq(billingPeriodAdjustments.organizationId, orgId))
  );
  expect(adjustments).toEqual([
    {
      billingPeriodStart: periodStart,
      billingPeriodEnd: periodEnd,
      fromBand: "starter",
      toBand: "growth",
      amountCents: 100800,
    },
  ]);
});

test("trial overview counts shipped orders without billing usage events", async ({
  db,
}) => {
  const id = randomUUID();
  const orgId = `trial-usage-${id}`;
  const createdAt = new Date("2026-06-01T00:00:00Z");

  await db.insert(organization).values({
    id: orgId,
    name: `Trial Usage ${id}`,
    slug: `trial-usage-${id}`,
    createdAt,
    plan: "trial",
    status: "active",
  });

  await withOrgContext(orgId, async (tx) => {
    const [customer] = await tx
      .insert(customers)
      .values({
        organizationId: orgId,
        name: `Trial Customer ${id}`,
      })
      .returning({ id: customers.id });

    await tx.insert(salesOrders).values([
      {
        organizationId: orgId,
        orderNumber: "TRIAL-SHIPPED",
        customerId: customer.id,
        customerName: `Trial Customer ${id}`,
        status: "done",
        shippedAt: new Date("2026-06-12T00:00:00Z"),
      },
      {
        organizationId: orgId,
        orderNumber: "TRIAL-OPEN",
        customerId: customer.id,
        customerName: `Trial Customer ${id}`,
        status: "open",
      },
    ]);

    const overview = await getBillingOverviewInTx(tx, orgId);
    expect(overview.salesOrderCount).toBe(1);
  });
});

test("Core overview counts shipped billing usage in the current calendar month", async ({
  db,
}) => {
  const id = randomUUID();
  const orgId = `core-usage-overview-${id}`;
  const now = new Date();
  const monthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
  );
  const previousMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15)
  );
  const currentMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 15)
  );

  await db.insert(organization).values({
    id: orgId,
    name: `Core Usage Overview ${id}`,
    slug: `core-usage-overview-${id}`,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    plan: "core",
    status: "active",
    salesOrderBand: "starter",
    billingInterval: "annual",
    currentPeriodStart: new Date("2026-01-01T00:00:00Z"),
    currentPeriodEnd: new Date("2027-01-01T00:00:00Z"),
  });

  await withOrgContext(orgId, async (tx) => {
    const [customer] = await tx
      .insert(customers)
      .values({
        organizationId: orgId,
        name: `Core Usage Customer ${id}`,
      })
      .returning({ id: customers.id });

    for (const [orderNumber, shippedAt] of [
      ["CORE-USAGE-PREVIOUS", previousMonth],
      ["CORE-USAGE-CURRENT", currentMonth],
    ] as const) {
      const [order] = await tx
        .insert(salesOrders)
        .values({
          organizationId: orgId,
          orderNumber,
          customerId: customer.id,
          customerName: `Core Usage Customer ${id}`,
          status: "done",
          shippedAt,
        })
        .returning({ id: salesOrders.id });

      await tx.insert(billingUsageEvents).values({
        organizationId: orgId,
        salesOrderId: order.id,
        eventType: "sales_order_shipped",
        billingPeriodStart:
          orderNumber === "CORE-USAGE-CURRENT" ? monthStart : previousMonth,
        billingPeriodEnd: new Date(
          Date.UTC(
            shippedAt.getUTCFullYear(),
            shippedAt.getUTCMonth() + 1,
            1
          )
        ),
        occurredAt: shippedAt,
      });
    }

    const overview = await getBillingOverviewInTx(tx, orgId);
    expect(overview.salesOrderCount).toBe(1);
    expect(overview.billingUsagePeriodStart).toEqual(monthStart);
    expect(overview.billingUsagePeriodEnd).toEqual(
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
    );
  });
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

test("billing actions accept only catalog lookup keys", async () => {
  const missing = await testFetch("/api/billing/checkout", {
    method: "POST",
    body: JSON.stringify({}),
  });
  expect(missing.status).toBe(400);

  const invalidChange = await testFetch("/api/billing/subscription", {
    method: "POST",
    headers: { "Idempotency-Key": "fast-invalid-subscription-offer" },
    body: JSON.stringify({
      action: "change_offer",
      lookupKey: "not_a_catalog_item",
    }),
  });
  expect(invalidChange.status).toBe(400);
});

test("checkout refuses catalog offers until Stripe catalog readiness is enabled", async () => {
  const response = await testFetch("/api/billing/checkout", {
    method: "POST",
    body: JSON.stringify({ lookupKey: "plugin_lot_tracking" }),
  });
  expect(response.status).toBe(503);
});
