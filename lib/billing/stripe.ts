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
  pluginsFromLookupKeys,
  type BillingPlan,
  type BillingPlugin,
  type BillingStatus,
} from "./types";

const STRIPE_API_VERSION = "2026-05-27.dahlia";

type BillingConfig = {
  secretKey: string;
  webhookSecret: string | null;
  corePriceId: string | null;
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

export function getBillingConfig(options?: {
  requireWebhookSecret?: boolean;
  requireCorePriceId?: boolean;
}): BillingConfig {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim() || null;
  const corePriceId = process.env.STRIPE_CORE_PRICE_ID?.trim() || null;

  if (
    !secretKey ||
    (options?.requireWebhookSecret && !webhookSecret) ||
    (options?.requireCorePriceId && !corePriceId)
  ) {
    throw new BillingConfigError();
  }

  return {
    secretKey,
    webhookSecret,
    corePriceId,
  };
}

export function getStripeClient(config = getBillingConfig()) {
  return new Stripe(config.secretKey, {
    apiVersion: STRIPE_API_VERSION,
  });
}

export function isStripeConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY?.trim());
}

export function isCheckoutConfigured() {
  return Boolean(
    process.env.STRIPE_SECRET_KEY?.trim() && process.env.STRIPE_CORE_PRICE_ID?.trim()
  );
}

function appUrl(path: string) {
  return new URL(path, getCanonicalAppUrl()).toString();
}

function isLiveModeExpected() {
  return process.env.STRIPE_LIVE_MODE === "1";
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
  idempotencyKey,
  successPath,
  cancelPath,
}: {
  orgId: string;
  orgName: string;
  userEmail: string;
  idempotencyKey: string;
  // Where Stripe sends the user back. Defaults to the billing settings page; the
  // onboarding flow overrides these so the user returns into the guided flow to
  // finalize (commit) their import after payment.
  successPath?: string;
  cancelPath?: string;
}) {
  const config = getBillingConfig({ requireCorePriceId: true });
  const stripe = getStripeClient(config);
  const billing = await getBillingStateByOrgId(orgId);
  const corePriceId = config.corePriceId;

  if (!corePriceId) {
    throw new BillingConfigError();
  }

  if (!billing) {
    throw new Error("Organization not found.");
  }

  if (billing.plan === "core") {
    throw new BillingConflictError(
      "This organization already has a Core subscription."
    );
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
      line_items: [{ price: corePriceId, quantity: 1 }],
      success_url: appUrl(successPath ?? "/settings/billing?success=1"),
      cancel_url: appUrl(cancelPath ?? "/settings/billing"),
      metadata: { organizationId: orgId },
      subscription_data: {
        metadata: { organizationId: orgId },
      },
    },
    { idempotencyKey: `org-core-checkout-${orgId}-${idempotencyKey}` }
  );

  await sendFounderAlert({
    kind: "checkout_started",
    subject: `Ashicore checkout started: ${orgName}`,
    idempotencyKey: `founder-alert-checkout-started-${session.id}`,
    fields: [
      { label: "Organization", value: orgName },
      { label: "Plan", value: "core" },
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
