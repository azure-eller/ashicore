import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import Stripe from "stripe";
import { and, eq, isNull, sql } from "drizzle-orm";
import { expect, test } from "../fixtures";
import { items, organization } from "../../../lib/db/schema";
import {
  billingLineItemsForCoreSelection,
  FREE_SKU_LIMIT,
  PRO_PLAN_LOOKUP_KEY,
  getSellableBillingOffer,
} from "../../../lib/billing/types";
import {
  billingIntentToCommercialSelection,
  normalizeBillingIntent,
  normalizeBillingSelection,
} from "../../../lib/billing/plan-intent";
import {
  assertFeatureAccessInTx,
  assertLocationCapacityInTx,
  assertSalesOrderCapacityInTx,
  FeatureEntitlementError,
  getFeatureAccessInTx,
} from "../../../lib/billing/entitlements";
import {
  assertSkuCapacityInTx,
  SkuCapacityError,
} from "../../../lib/billing/sku-capacity";
import { reconcileBillingPageState } from "../../../lib/billing/page-reconciliation";
import { withOrgContext } from "../../../lib/db/with-org-context";
import { getBaseUrl, getOrgId } from "../../helpers/api";

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? "";
const FREE_GRACE_BACKFILL_SQL = readFileSync(
  "drizzle/0186_free_grace_backfill.sql",
  "utf8",
);

function subscriptionEventBody({
  customerId,
  orgId,
  subscriptionId,
  type,
  status,
  lookupKey,
  cancelAtPeriodEnd = false,
}: {
  customerId: string;
  orgId: string;
  subscriptionId: string;
  type: "customer.subscription.updated" | "customer.subscription.deleted";
  status: string;
  lookupKey: string;
  cancelAtPeriodEnd?: boolean;
}) {
  const now = Math.floor(Date.now() / 1000);
  return JSON.stringify({
    id: `evt_${randomUUID().replaceAll("-", "")}`,
    object: "event",
    created: now,
    livemode: false,
    type,
    data: {
      object: {
        id: subscriptionId,
        object: "subscription",
        customer: customerId,
        status,
        cancel_at_period_end: cancelAtPeriodEnd,
        metadata: { organizationId: orgId },
        items: {
          object: "list",
          data: [
            {
              id: "si_pro",
              object: "subscription_item",
              current_period_start: now,
              current_period_end: now + 30 * 24 * 60 * 60,
              quantity: 1,
              price: { id: `price_${lookupKey}`, object: "price", lookup_key: lookupKey },
            },
          ],
        },
      },
    },
  });
}

function customerDeletedEventBody({ customerId }: { customerId: string }) {
  return JSON.stringify({
    id: `evt_${randomUUID().replaceAll("-", "")}`,
    object: "event",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    type: "customer.deleted",
    data: {
      object: {
        id: customerId,
        object: "customer",
        deleted: true,
      },
    },
  });
}

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
  if (!WEBHOOK_SECRET) throw new Error("STRIPE_WEBHOOK_SECRET is required.");
});

test("legacy public plan selections normalize to Free or Pro", () => {
  expect(normalizeBillingSelection("trial")).toBe("free");
  expect(normalizeBillingSelection("free")).toBe("free");
  expect(normalizeBillingSelection("core")).toBe(PRO_PLAN_LOOKUP_KEY);
  expect(normalizeBillingSelection("paid")).toBe(PRO_PLAN_LOOKUP_KEY);
  expect(normalizeBillingSelection("pro")).toBe(PRO_PLAN_LOOKUP_KEY);
  expect(
    billingIntentToCommercialSelection(normalizeBillingIntent({ plan: "pro" }))
  ).toMatchObject({ mode: "core" });
});

test("unbilled legacy paid organizations enter Free grace without touching billed Pro", async ({
  db,
}) => {
  const orgId = getOrgId();
  const [original] = await db
    .select({
      plan: organization.plan,
      status: organization.status,
      stripeSubscriptionId: organization.stripeSubscriptionId,
      skuLimitStartsAt: organization.skuLimitStartsAt,
    })
    .from(organization)
    .where(eq(organization.id, orgId));

  try {
    const graceEnd = new Date("2026-08-18T22:18:43Z");
    await db
      .update(organization)
      .set({
        plan: "core",
        status: "active",
        stripeSubscriptionId: null,
        skuLimitStartsAt: graceEnd,
      })
      .where(eq(organization.id, orgId));
    await db.execute(sql.raw(FREE_GRACE_BACKFILL_SQL));

    const [free] = await db
      .select({
        plan: organization.plan,
        status: organization.status,
        stripeSubscriptionId: organization.stripeSubscriptionId,
        skuLimitStartsAt: organization.skuLimitStartsAt,
      })
      .from(organization)
      .where(eq(organization.id, orgId));
    expect(free).toMatchObject({
      plan: "free",
      status: "active",
      stripeSubscriptionId: null,
      skuLimitStartsAt: graceEnd,
    });

    await db
      .update(organization)
      .set({ plan: "pro", stripeSubscriptionId: "sub_paid" })
      .where(eq(organization.id, orgId));
    await db.execute(sql.raw(FREE_GRACE_BACKFILL_SQL));
    const [paid] = await db
      .select({ plan: organization.plan, stripeSubscriptionId: organization.stripeSubscriptionId })
      .from(organization)
      .where(eq(organization.id, orgId));
    expect(paid).toEqual({ plan: "pro", stripeSubscriptionId: "sub_paid" });
  } finally {
    await db
      .update(organization)
      .set(original)
      .where(eq(organization.id, orgId));
  }
});

test("only the Pro catalog offer is sellable", () => {
  expect(getSellableBillingOffer(PRO_PLAN_LOOKUP_KEY)?.lookupKey).toBe(
    PRO_PLAN_LOOKUP_KEY
  );
  expect(getSellableBillingOffer("core_starter_monthly")).toBeNull();
});

test("billing page reconciliation refreshes after Stripe sync and falls back when Stripe is unavailable", async () => {
  const current = { plan: "free", revision: 1 };
  const refreshed = { plan: "pro", revision: 2 };
  let reconciled = false;

  await expect(
    reconcileBillingPageState({
      current,
      reconcile: async () => {
        reconciled = true;
      },
      reread: async () => refreshed,
      onError: () => {
        throw new Error("Unexpected reconciliation error.");
      },
    }),
  ).resolves.toBe(refreshed);
  expect(reconciled).toBe(true);

  const rereadError = new Error("Database reread failed");
  await expect(
    reconcileBillingPageState({
      current,
      reconcile: async () => undefined,
      reread: async () => {
        throw rereadError;
      },
      onError: () => {
        throw new Error("A reread failure is not a Stripe reconciliation failure.");
      },
    }),
  ).rejects.toBe(rereadError);

  const stripeError = new Error("Stripe unavailable");
  let reported: unknown;
  await expect(
    reconcileBillingPageState({
      current,
      reconcile: async () => {
        throw stripeError;
      },
      reread: async () => refreshed,
      onError: (error) => {
        reported = error;
      },
    }),
  ).resolves.toBe(current);
  expect(reported).toBe(stripeError);

  await expect(
    reconcileBillingPageState({
      current,
      reconcile: async () => {
        throw stripeError;
      },
      reread: async () => refreshed,
      onError: () => {
        throw new Error("Reporting unavailable");
      },
    }),
  ).resolves.toBe(current);
});

test("every paid checkout selection resolves to one flat Pro item", () => {
  expect(
    billingLineItemsForCoreSelection({
      mode: "core",
      band: "pro",
      interval: "annual",
      locationCapacity: 25,
      addonLookupKeys: ["everything"],
    })
  ).toEqual([{ lookupKey: PRO_PLAN_LOOKUP_KEY, quantity: 1 }]);
});

test("commercial features are available to everyone while beta remains allowlisted", async ({ db }) => {
  const orgId = getOrgId();
  const [original] = await db
    .select({ betaFeatures: organization.betaFeatures, entitlements: organization.entitlements })
    .from(organization)
    .where(eq(organization.id, orgId));

  try {
    await db
      .update(organization)
      .set({ betaFeatures: [], entitlements: [] })
      .where(eq(organization.id, orgId));

    await withOrgContext(orgId, async (tx) => {
      await expect(getFeatureAccessInTx(tx, orgId, "lot_tracking")).resolves.toMatchObject({
        entitled: true,
        locked: false,
      });
      await expect(assertFeatureAccessInTx(tx, orgId, "crm")).resolves.toMatchObject({
        allowed: true,
      });
      await expect(assertLocationCapacityInTx(tx, orgId)).resolves.toMatchObject({ allowed: true });
      await expect(assertSalesOrderCapacityInTx(tx, orgId)).resolves.toMatchObject({ allowed: true });
      await expect(
        assertFeatureAccessInTx(tx, orgId, "pricing_scenarios")
      ).rejects.toBeInstanceOf(FeatureEntitlementError);
    });

    await db
      .update(organization)
      .set({ betaFeatures: ["pricing_scenarios"] })
      .where(eq(organization.id, orgId));
    await withOrgContext(orgId, async (tx) => {
      await expect(
        assertFeatureAccessInTx(tx, orgId, "pricing_scenarios")
      ).resolves.toMatchObject({ allowed: true });
    });
  } finally {
    await db
      .update(organization)
      .set({ betaFeatures: original.betaFeatures, entitlements: original.entitlements })
      .where(eq(organization.id, orgId));
  }
});

test("expired Free stops at 30 active rows while grace and Pro are unlimited", async ({ db }) => {
  const orgId = getOrgId();
  const [original] = await db
    .select({ plan: organization.plan, skuLimitStartsAt: organization.skuLimitStartsAt })
    .from(organization)
    .where(eq(organization.id, orgId));
  const [{ count }] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(items)
    .where(and(eq(items.organizationId, orgId), isNull(items.deletedAt)));
  const activeCount = Number(count);

  try {
    await db
      .update(organization)
      .set({ plan: "free", skuLimitStartsAt: new Date("2020-01-01T00:00:00Z") })
      .where(eq(organization.id, orgId));
    await expect(
      withOrgContext(orgId, (tx) =>
        assertSkuCapacityInTx(tx, orgId, Math.max(1, FREE_SKU_LIMIT + 1 - activeCount))
      )
    ).rejects.toBeInstanceOf(SkuCapacityError);

    await db
      .update(organization)
      .set({ skuLimitStartsAt: new Date("2999-01-01T00:00:00Z") })
      .where(eq(organization.id, orgId));
    await expect(
      withOrgContext(orgId, (tx) => assertSkuCapacityInTx(tx, orgId, 250))
    ).resolves.toMatchObject({ allowed: true });

    await db.update(organization).set({ plan: "pro" }).where(eq(organization.id, orgId));
    await expect(
      withOrgContext(orgId, (tx) => assertSkuCapacityInTx(tx, orgId, 250))
    ).resolves.toMatchObject({ allowed: true });
  } finally {
    await db
      .update(organization)
      .set({ plan: original.plan, skuLimitStartsAt: original.skuLimitStartsAt })
      .where(eq(organization.id, orgId));
  }
});

test("Pro webhooks preserve access through scheduled cancellation and downgrade on terminal events", async ({
  db,
}) => {
  const orgId = getOrgId();
  const customerId = `cus_${randomUUID().replaceAll("-", "")}`;
  const subscriptionId = `sub_${randomUUID().replaceAll("-", "")}`;
  const [original] = await db
    .select({
      plan: organization.plan,
      status: organization.status,
      stripeCustomerId: organization.stripeCustomerId,
      stripeSubscriptionId: organization.stripeSubscriptionId,
    })
    .from(organization)
    .where(eq(organization.id, orgId));

  try {
    const active = subscriptionEventBody({
      customerId,
      orgId,
      subscriptionId,
      type: "customer.subscription.updated",
      status: "active",
      lookupKey: PRO_PLAN_LOOKUP_KEY,
    });
    expect((await postSignedWebhook(active)).status).toBe(200);
    const [paid] = await db
      .select({ plan: organization.plan, subscriptionId: organization.stripeSubscriptionId })
      .from(organization)
      .where(eq(organization.id, orgId));
    expect(paid).toMatchObject({ plan: "pro", subscriptionId });

    const unknownPrice = subscriptionEventBody({
      customerId,
      orgId,
      subscriptionId,
      type: "customer.subscription.updated",
      status: "past_due",
      lookupKey: "unmapped_paid_price",
    });
    expect((await postSignedWebhook(unknownPrice)).status).toBe(200);
    const [unknownPaid] = await db
      .select({
        plan: organization.plan,
        status: organization.status,
        subscriptionId: organization.stripeSubscriptionId,
      })
      .from(organization)
      .where(eq(organization.id, orgId));
    expect(unknownPaid).toMatchObject({
      plan: "pro",
      status: "past_due",
      subscriptionId,
    });

    const scheduledCancellation = subscriptionEventBody({
      customerId,
      orgId,
      subscriptionId,
      type: "customer.subscription.updated",
      status: "active",
      lookupKey: PRO_PLAN_LOOKUP_KEY,
      cancelAtPeriodEnd: true,
    });
    expect((await postSignedWebhook(scheduledCancellation)).status).toBe(200);
    const [scheduled] = await db
      .select({
        plan: organization.plan,
        subscriptionId: organization.stripeSubscriptionId,
        cancelAtPeriodEnd: organization.cancelAtPeriodEnd,
      })
      .from(organization)
      .where(eq(organization.id, orgId));
    expect(scheduled).toMatchObject({
      plan: "pro",
      subscriptionId,
      cancelAtPeriodEnd: true,
    });

    const canceled = subscriptionEventBody({
      customerId,
      orgId,
      subscriptionId,
      type: "customer.subscription.deleted",
      status: "canceled",
      lookupKey: PRO_PLAN_LOOKUP_KEY,
    });
    expect((await postSignedWebhook(canceled)).status).toBe(200);
    const [free] = await db
      .select({
        plan: organization.plan,
        status: organization.status,
        subscriptionId: organization.stripeSubscriptionId,
      })
      .from(organization)
      .where(eq(organization.id, orgId));
    expect(free).toMatchObject({ plan: "free", status: "active", subscriptionId: null });

    await db
      .update(organization)
      .set({
        plan: "pro",
        status: "active",
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscriptionId,
      })
      .where(eq(organization.id, orgId));
    expect((await postSignedWebhook(customerDeletedEventBody({ customerId }))).status).toBe(200);
    const [customerDeleted] = await db
      .select({
        plan: organization.plan,
        status: organization.status,
        customerId: organization.stripeCustomerId,
        subscriptionId: organization.stripeSubscriptionId,
      })
      .from(organization)
      .where(eq(organization.id, orgId));
    expect(customerDeleted).toMatchObject({
      plan: "free",
      status: "active",
      customerId: null,
      subscriptionId: null,
    });
  } finally {
    await db
      .update(organization)
      .set({
        plan: original.plan,
        status: original.status,
        stripeCustomerId: original.stripeCustomerId,
        stripeSubscriptionId: original.stripeSubscriptionId,
      })
      .where(eq(organization.id, orgId));
  }
});
