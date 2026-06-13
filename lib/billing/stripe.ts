import "server-only";

import Stripe from "stripe";
import { getCanonicalAppUrl } from "@/lib/app-url";
import {
  getBillingStateByOrgId,
  getOrgByStripeCustomerId,
  setOrgStripeCustomerId,
  updateOrgBillingState,
} from "./dal";
import { sendFounderAlert } from "@/lib/internal-alerts";
import {
  BILLING_CATALOG,
  getBillingOffer,
  pluginsFromLookupKeys,
  type BillingPlan,
  type BillingPlugin,
  type BillingStatus,
} from "./types";
import { env } from "@/lib/env";
import { isCheckoutConfigured } from "./config";
export { isCheckoutConfigured, isStripeConfigured } from "./config";

const STRIPE_API_VERSION = "2026-05-27.dahlia";

type BillingConfig = {
  secretKey: string;
  webhookSecret: string | null;
};

export class BillingConfigError extends Error {
  status = 503;

  constructor(message = "Stripe billing is not configured.") {
    super(message);
    this.name = "BillingConfigError";
  }
}

export class BillingWebhookVerificationError extends Error {
  status = 400;

  constructor(message = "Invalid Stripe webhook.") {
    super(message);
    this.name = "BillingWebhookVerificationError";
  }
}

export class BillingConflictError extends Error {
  status = 409;

  constructor(message: string) {
    super(message);
    this.name = "BillingConflictError";
  }
}

export class BillingSubscriptionError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "BillingSubscriptionError";
    this.status = status;
  }
}

export function getBillingConfig(options?: {
  requireWebhookSecret?: boolean;
}): BillingConfig {
  const secretKey = env.STRIPE_SECRET_KEY?.trim();
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET?.trim() || null;

  if (!secretKey || (options?.requireWebhookSecret && !webhookSecret)) {
    throw new BillingConfigError();
  }

  return {
    secretKey,
    webhookSecret,
  };
}

export function getStripeClient(config = getBillingConfig()) {
  return new Stripe(config.secretKey, {
    apiVersion: STRIPE_API_VERSION,
  });
}

function appUrl(path: string) {
  return new URL(path, getCanonicalAppUrl()).toString();
}

function isLiveModeExpected() {
  return env.STRIPE_LIVE_MODE === "1";
}

export function assertStripeMode(livemode: boolean) {
  if (livemode !== isLiveModeExpected()) {
    throw new BillingWebhookVerificationError(
      "Stripe event mode does not match this environment."
    );
  }
}

export async function createCheckoutSession({
  orgId,
  orgName,
  userEmail,
  lookupKey,
  idempotencyKey,
  successPath,
  cancelPath,
}: {
  orgId: string;
  orgName: string;
  userEmail: string;
  lookupKey: string;
  idempotencyKey: string;
  // Where Stripe sends the user back. Defaults to the billing settings page; the
  // onboarding flow overrides these so the user returns into the guided flow to
  // finalize (commit) their import after payment.
  successPath?: string;
  cancelPath?: string;
}) {
  const offer = getBillingOffer(lookupKey);
  if (!offer) {
    throw new BillingConfigError(`Unknown catalog item: ${lookupKey}`);
  }
  if (!isCheckoutConfigured()) {
    throw new BillingConfigError("Stripe checkout catalog is not configured.");
  }

  const stripe = getStripeClient();
  const billing = await getBillingStateByOrgId(orgId);

  if (!billing) {
    throw new Error("Organization not found.");
  }

  let stripeCustomerId = billing.stripeCustomerId;

  if (!stripeCustomerId) {
    const customer = await stripe.customers.create(
      {
        name: orgName,
        email: userEmail,
        metadata: { organizationId: orgId },
      },
      { idempotencyKey: `org-customer-${orgId}` }
    );
    stripeCustomerId = customer.id;
    await setOrgStripeCustomerId(orgId, stripeCustomerId);
  } else {
    const subscriptions = await stripe.subscriptions.list({
      customer: stripeCustomerId,
      status: "all",
      limit: 20,
    });
    const incompleteSubscriptions = subscriptions.data.filter(
      (subscription) => subscription.status === "incomplete"
    );
    await Promise.all(
      incompleteSubscriptions.map((subscription) =>
        stripe.subscriptions.cancel(subscription.id)
      )
    );
    const existing = subscriptions.data.find((subscription) =>
      ["active", "trialing", "past_due", "unpaid", "paused"].includes(
        subscription.status
      )
    );

    if (existing) {
      throw new BillingConflictError(
        "This organization already has a Stripe subscription."
      );
    }
  }

  const prices = await stripe.prices.list({
    lookup_keys: [lookupKey],
    active: true,
    limit: 1,
  });
  const price = prices.data[0];
  if (!price) {
    throw new BillingConfigError(
      `No active Stripe price has the lookup key ${lookupKey}. Run scripts/stripe-create-catalog.ts.`
    );
  }

  const session = await stripe.checkout.sessions.create(
    {
      mode: "subscription",
      branding_settings: {
        background_color: "#F3F3F4",
        border_style: "rounded",
        button_color: "#F2CD34",
        display_name: "ashicore",
        font_family: "inter",
        icon: {
          type: "url",
          url: "https://ashicore.app/icon.svg",
        },
      },
      customer: stripeCustomerId,
      custom_text: {
        submit: {
          message:
            "Start your Ashicore workspace. You can manage billing from settings after checkout.",
        },
      },
      line_items: [{ price: price.id, quantity: 1 }],
      success_url: appUrl(successPath ?? "/settings/billing?success=1"),
      cancel_url: appUrl(cancelPath ?? "/settings/billing"),
      metadata: { organizationId: orgId },
      subscription_data: {
        metadata: { organizationId: orgId },
      },
    },
    { idempotencyKey: `org-checkout-${orgId}-${lookupKey}-${idempotencyKey}` }
  );

  await sendFounderAlert({
    kind: "checkout_started",
    subject: `Ashicore checkout started: ${orgName}`,
    idempotencyKey: `founder-alert-checkout-started-${session.id}`,
    fields: [
      { label: "Organization", value: orgName },
      { label: "Catalog item", value: offer.name },
      { label: "User email", value: userEmail },
      { label: "Organization ID", value: orgId },
      { label: "Stripe customer ID", value: stripeCustomerId },
      { label: "Checkout session ID", value: session.id },
      { label: "Checkout URL", value: session.url },
    ],
  });

  return session;
}

export async function createPortalSession({ orgId }: { orgId: string }) {
  const stripe = getStripeClient();
  const billing = await getBillingStateByOrgId(orgId);

  if (!billing?.stripeCustomerId) {
    throw new BillingConfigError("No Stripe customer exists for this organization.");
  }

  return stripe.billingPortal.sessions.create({
    customer: billing.stripeCustomerId,
    return_url: appUrl("/settings/billing"),
  });
}

async function getActivePriceForLookupKey(stripe: Stripe, lookupKey: string) {
  const prices = await stripe.prices.list({
    lookup_keys: [lookupKey],
    active: true,
    limit: 1,
  });
  const price = prices.data[0];
  if (!price) {
    throw new BillingConfigError(
      `No active Stripe price has the lookup key ${lookupKey}. Run scripts/stripe-create-catalog.ts.`
    );
  }
  return price;
}

function knownBillingLookupKey(item: Stripe.SubscriptionItem) {
  const lookupKey = item.price?.lookup_key;
  return lookupKey && getBillingOffer(lookupKey) ? lookupKey : null;
}

function currentBillingLookupKeys(subscription: Stripe.Subscription) {
  return subscription.items.data
    .map(knownBillingLookupKey)
    .filter((key): key is string => key !== null);
}

function nextLookupKeysForOffer(currentLookupKeys: string[], lookupKey: string) {
  const offer = getBillingOffer(lookupKey);
  if (!offer) {
    throw new BillingSubscriptionError("Unknown catalog item.");
  }

  if (offer.kind === "everything") {
    return [lookupKey];
  }

  const next = new Set(
    currentLookupKeys.filter((currentKey) => {
      const currentOffer = getBillingOffer(currentKey);
      if (!currentOffer) return false;
      if (currentOffer.kind === "everything") return false;
      if (offer.kind === "package" && currentOffer.kind === "package") return false;
      if (
        offer.kind === "package" &&
        currentOffer.kind === "plugin" &&
        currentOffer.plugins.every((plugin) => offer.plugins.includes(plugin))
      ) {
        return false;
      }
      return true;
    })
  );
  next.add(lookupKey);

  return BILLING_CATALOG.map((catalogOffer) => catalogOffer.lookupKey).filter((key) =>
    next.has(key)
  );
}

function sameLookupKeySet(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((key) => rightSet.has(key));
}

async function getCurrentSubscription(stripe: Stripe, orgId: string) {
  const billing = await getBillingStateByOrgId(orgId);
  if (!billing?.stripeSubscriptionId) {
    throw new BillingSubscriptionError(
      "This organization does not have an active Stripe subscription.",
      409
    );
  }

  return stripe.subscriptions.retrieve(billing.stripeSubscriptionId);
}

export async function changeSubscriptionOffer({
  orgId,
  orgName,
  lookupKey,
  idempotencyKey,
}: {
  orgId: string;
  orgName: string;
  lookupKey: string;
  idempotencyKey: string;
}) {
  const targetOffer = getBillingOffer(lookupKey);
  if (!targetOffer) {
    throw new BillingSubscriptionError("Unknown catalog item.");
  }
  if (!isCheckoutConfigured()) {
    throw new BillingConfigError("Stripe checkout catalog is not configured.");
  }

  const stripe = getStripeClient();
  const subscription = await getCurrentSubscription(stripe, orgId);
  const currentLookupKeys = currentBillingLookupKeys(subscription);
  const nextLookupKeys = nextLookupKeysForOffer(currentLookupKeys, lookupKey);

  if (
    sameLookupKeySet(currentLookupKeys, nextLookupKeys) &&
    !subscription.cancel_at_period_end
  ) {
    return subscription;
  }

  const pricesByLookupKey = new Map(
    await Promise.all(
      nextLookupKeys.map(async (key) => {
        const price = await getActivePriceForLookupKey(stripe, key);
        return [key, price] as const;
      })
    )
  );
  const nextLookupKeySet = new Set(nextLookupKeys);
  const currentLookupKeySet = new Set(currentLookupKeys);
  const items: Stripe.SubscriptionUpdateParams.Item[] = [];

  for (const item of subscription.items.data) {
    const itemLookupKey = knownBillingLookupKey(item);
    if (itemLookupKey && !nextLookupKeySet.has(itemLookupKey)) {
      items.push({ id: item.id, deleted: true });
    }
  }

  for (const key of nextLookupKeys) {
    if (!currentLookupKeySet.has(key)) {
      const price = pricesByLookupKey.get(key);
      if (!price) throw new BillingConfigError();
      items.push({ price: price.id, quantity: 1 });
    }
  }

  const updateParams: Stripe.SubscriptionUpdateParams = {
    cancel_at_period_end: false,
    metadata: { organizationId: orgId },
    proration_behavior: "create_prorations",
  };
  if (items.length > 0) {
    updateParams.items = items;
  }

  const updated = await stripe.subscriptions.update(subscription.id, updateParams, {
    idempotencyKey: `org-subscription-change-${orgId}-${idempotencyKey}`,
  });

  await applySubscriptionState({ subscription: updated, orgId });
  await sendFounderAlert({
    kind: "subscription_active",
    subject: `Ashicore subscription changed: ${orgName}`,
    idempotencyKey: `founder-alert-subscription-change-${updated.id}-${idempotencyKey}`,
    fields: [
      { label: "Organization", value: orgName },
      { label: "Catalog item", value: targetOffer.name },
      { label: "Organization ID", value: orgId },
      { label: "Subscription ID", value: updated.id },
      { label: "Lookup keys", value: nextLookupKeys.join(", ") },
    ],
  });

  return updated;
}

export async function cancelSubscriptionAtPeriodEnd({
  orgId,
  orgName,
  idempotencyKey,
}: {
  orgId: string;
  orgName: string;
  idempotencyKey: string;
}) {
  const stripe = getStripeClient();
  const subscription = await getCurrentSubscription(stripe, orgId);
  const updated = await stripe.subscriptions.update(
    subscription.id,
    { cancel_at_period_end: true },
    { idempotencyKey: `org-subscription-cancel-${orgId}-${idempotencyKey}` }
  );

  await applySubscriptionState({ subscription: updated, orgId });
  await sendFounderAlert({
    kind: "subscription_attention",
    subject: `Ashicore subscription cancel scheduled: ${orgName}`,
    idempotencyKey: `founder-alert-subscription-cancel-${updated.id}-${idempotencyKey}`,
    fields: [
      { label: "Organization", value: orgName },
      { label: "Organization ID", value: orgId },
      { label: "Subscription ID", value: updated.id },
      { label: "Current period end", value: periodEndDate(updated) },
    ],
  });

  return updated;
}

export async function resumeSubscription({
  orgId,
  orgName,
  idempotencyKey,
}: {
  orgId: string;
  orgName: string;
  idempotencyKey: string;
}) {
  const stripe = getStripeClient();
  const subscription = await getCurrentSubscription(stripe, orgId);
  const updated = await stripe.subscriptions.update(
    subscription.id,
    { cancel_at_period_end: false },
    { idempotencyKey: `org-subscription-resume-${orgId}-${idempotencyKey}` }
  );

  await applySubscriptionState({ subscription: updated, orgId });
  await sendFounderAlert({
    kind: "subscription_active",
    subject: `Ashicore subscription resumed: ${orgName}`,
    idempotencyKey: `founder-alert-subscription-resume-${updated.id}-${idempotencyKey}`,
    fields: [
      { label: "Organization", value: orgName },
      { label: "Organization ID", value: orgId },
      { label: "Subscription ID", value: updated.id },
      { label: "Current period end", value: periodEndDate(updated) },
    ],
  });

  return updated;
}

function periodEndDate(subscription: Stripe.Subscription) {
  const periodEnd =
    subscription.items.data
      .map((item) => item.current_period_end)
      .filter((value): value is number => typeof value === "number")
      .sort((a, b) => b - a)[0] ??
    (subscription as Stripe.Subscription & { current_period_end?: number })
      .current_period_end;

  return periodEnd
    ? new Date(periodEnd * 1000)
    : null;
}

// Plugin entitlements survive past_due/unpaid (grace period — dunning handles
// recovery); they drop only when the subscription is truly gone.
const ENTITLED_SUBSCRIPTION_STATUSES: Stripe.Subscription.Status[] = [
  "active",
  "trialing",
  "paused",
  "past_due",
  "unpaid",
];

function entitlementsFromSubscription(
  subscription: Stripe.Subscription
): BillingPlugin[] {
  if (!ENTITLED_SUBSCRIPTION_STATUSES.includes(subscription.status)) {
    return [];
  }

  return pluginsFromLookupKeys(
    subscription.items.data.map((item) => item.price?.lookup_key)
  );
}

function canReplaceCurrentSubscription(
  currentSubscriptionId: string | null,
  subscription: Stripe.Subscription
) {
  if (!currentSubscriptionId || currentSubscriptionId === subscription.id) {
    return true;
  }

  return ENTITLED_SUBSCRIPTION_STATUSES.includes(subscription.status);
}

function stateFromSubscription(subscription: Stripe.Subscription): {
  plan: BillingPlan;
  status: BillingStatus;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: Date | null;
} {
  if (
    subscription.status === "active" ||
    subscription.status === "trialing" ||
    subscription.status === "paused"
  ) {
    return {
      plan: "core",
      status: "active",
      cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
      currentPeriodEnd: periodEndDate(subscription),
    };
  }

  if (
    subscription.status === "past_due" ||
    subscription.status === "unpaid"
  ) {
    return {
      plan: "core",
      status: "past_due",
      cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
      currentPeriodEnd: periodEndDate(subscription),
    };
  }

  if (subscription.status === "incomplete") {
    return {
      plan: "free",
      status: "past_due",
      cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
      currentPeriodEnd: periodEndDate(subscription),
    };
  }

  return {
    plan: "free",
    status: "canceled",
    cancelAtPeriodEnd: false,
    currentPeriodEnd: null,
  };
}

async function retrieveSubscription(
  stripe: Stripe,
  subscriptionId: string,
  fallback?: Stripe.Subscription
) {
  try {
    return await stripe.subscriptions.retrieve(subscriptionId);
  } catch (error) {
    if (fallback) return fallback;
    throw error;
  }
}

export async function applySubscriptionState({
  subscription,
  orgId,
}: {
  subscription: Stripe.Subscription;
  orgId?: string | null;
}) {
  const stripeCustomerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer.id;
  const org =
    (stripeCustomerId ? await getOrgByStripeCustomerId(stripeCustomerId) : null) ??
    (orgId ? await getBillingStateByOrgId(orgId) : null);

  if (!org) {
    console.warn("Stripe subscription has no matching organization.", {
      subscriptionId: subscription.id,
      stripeCustomerId,
      orgId,
    });
    return;
  }

  const state = stateFromSubscription(subscription);
  if (!canReplaceCurrentSubscription(org.stripeSubscriptionId, subscription)) {
    console.warn("Ignoring stale Stripe subscription state for current organization.", {
      orgId: org.id,
      currentSubscriptionId: org.stripeSubscriptionId,
      eventSubscriptionId: subscription.id,
      stripeCustomerId,
      stripeSubscriptionStatus: subscription.status,
    });
    return;
  }

  const entitlements = entitlementsFromSubscription(subscription);
  await updateOrgBillingState({
    orgId: org.id,
    stripeCustomerId,
    stripeSubscriptionId: state.status === "canceled" ? null : subscription.id,
    entitlements,
    ...state,
  });

  if (state.plan === "core" && state.status === "active") {
    await sendFounderAlert({
      kind: "subscription_active",
      subject: `New Ashicore paid subscription: ${org.name}`,
      idempotencyKey: `founder-alert-subscription-active-${subscription.id}`,
      fields: [
        { label: "Organization", value: org.name },
        { label: "Plan", value: state.plan },
        { label: "Status", value: state.status },
        { label: "Organization ID", value: org.id },
        { label: "Stripe customer ID", value: stripeCustomerId },
        { label: "Subscription ID", value: subscription.id },
        { label: "Current period end", value: state.currentPeriodEnd },
      ],
    });
  } else if (state.status === "past_due" || state.status === "canceled") {
    await sendFounderAlert({
      kind: "subscription_attention",
      subject: `Ashicore subscription needs attention: ${org.name}`,
      idempotencyKey: `founder-alert-subscription-${state.status}-${subscription.id}`,
      fields: [
        { label: "Organization", value: org.name },
        { label: "Plan", value: state.plan },
        { label: "Status", value: state.status },
        { label: "Organization ID", value: org.id },
        { label: "Stripe customer ID", value: stripeCustomerId },
        { label: "Subscription ID", value: subscription.id },
        { label: "Stripe subscription status", value: subscription.status },
      ],
    });
  }
}

export async function syncOrgBillingFromStripe(orgId: string) {
  const stripe = getStripeClient();
  const billing = await getBillingStateByOrgId(orgId);

  if (!billing?.stripeCustomerId) {
    return billing;
  }

  const subscriptions = await stripe.subscriptions.list({
    customer: billing.stripeCustomerId,
    status: "all",
    limit: 20,
  });
  const active = subscriptions.data.filter((subscription) =>
    ["active", "trialing", "past_due", "unpaid", "paused"].includes(
      subscription.status
    )
  );

  if (active.length > 1) {
    console.warn("Stripe customer has duplicate active Core subscriptions.", {
      orgId,
      stripeCustomerId: billing.stripeCustomerId,
      subscriptionIds: active.map((subscription) => subscription.id),
    });
  }

  const subscription = active[0] ?? subscriptions.data[0];

  if (!subscription) {
    await updateOrgBillingState({
      orgId,
      plan: "free",
      status: "canceled",
      stripeCustomerId: billing.stripeCustomerId,
      stripeSubscriptionId: null,
      entitlements: [],
    });
    return getBillingStateByOrgId(orgId);
  }

  await applySubscriptionState({ subscription, orgId });
  return getBillingStateByOrgId(orgId);
}

export async function handleStripeWebhook(body: string, signature: string | null) {
  const config = getBillingConfig({ requireWebhookSecret: true });
  const stripe = getStripeClient(config);

  if (!signature || !config.webhookSecret) {
    throw new BillingWebhookVerificationError();
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, config.webhookSecret);
  } catch (error) {
    if (error instanceof Stripe.errors.StripeSignatureVerificationError) {
      throw new BillingWebhookVerificationError();
    }
    throw error;
  }
  assertStripeMode(event.livemode);

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const subscriptionId =
      typeof session.subscription === "string"
        ? session.subscription
        : session.subscription?.id;
    if (!subscriptionId) return;
    const subscription = await retrieveSubscription(stripe, subscriptionId);
    await applySubscriptionState({
      subscription,
      orgId: session.metadata?.organizationId ?? null,
    });
    return;
  }

  if (
    event.type === "customer.subscription.created" ||
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    const eventSubscription = event.data.object;
    const subscription = await retrieveSubscription(
      stripe,
      eventSubscription.id,
      eventSubscription
    );
    await applySubscriptionState({
      subscription,
      orgId: subscription.metadata?.organizationId ?? null,
    });
    return;
  }

  if (event.type === "customer.deleted") {
    const customer = event.data.object;
    const org = await getOrgByStripeCustomerId(customer.id);
    if (org) {
      await updateOrgBillingState({
        orgId: org.id,
        plan: "free",
        status: "canceled",
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        entitlements: [],
        cancelAtPeriodEnd: false,
        currentPeriodEnd: null,
      });
    }
  }
}
