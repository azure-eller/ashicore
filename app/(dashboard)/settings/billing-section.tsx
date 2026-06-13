"use client";

import { useCallback, useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Alert02Icon, CreditCardIcon, RefreshIcon } from "@hugeicons/core-free-icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import {
  SettingsBlock,
  SettingsCard,
  SettingsFootnote,
  SettingsPageHeader,
  SettingsQuietRow,
} from "@/components/settings-panel";
import { apiJson } from "@/lib/client/api";
import {
  BILLING_CATALOG,
  type BillingOffer,
  type BillingPlugin,
} from "@/lib/billing/types";
import type { BillingPageData } from "./types";

type BillingActionResponse = {
  url?: string;
};

function formatDate(value: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function offerIncluded(offer: BillingOffer, entitlements: BillingPlugin[]) {
  return offer.plugins.every((plugin) => entitlements.includes(plugin));
}

// The display name for what the org currently has: Everything beats an exact
// package match beats a list of plugin names beats Free.
function describeCurrentPlan(entitlements: BillingPlugin[]) {
  if (entitlements.length === 0) return "Free";
  const everything = BILLING_CATALOG.find((offer) => offer.kind === "everything");
  if (everything && everything.plugins.every((p) => entitlements.includes(p))) {
    return everything.name;
  }
  const exactPackage = BILLING_CATALOG.find(
    (offer) =>
      offer.kind === "package" &&
      offer.plugins.length === entitlements.length &&
      offer.plugins.every((p) => entitlements.includes(p))
  );
  if (exactPackage) return exactPackage.name;
  return BILLING_CATALOG.filter(
    (offer) => offer.kind === "plugin" && offerIncluded(offer, entitlements)
  )
    .map((offer) => offer.name)
    .join(" · ");
}

function PlanStatusBadge({ data }: { data: BillingPageData }) {
  if (data.cancelAtPeriodEnd) {
    return <Badge variant="warning">Ends at period end</Badge>;
  }
  if (data.status === "past_due") {
    return <Badge variant="destructive">Payment past due</Badge>;
  }
  if (data.status === "canceled") {
    return <Badge variant="secondary">Canceled</Badge>;
  }
  return (
    <Badge variant="success">
      <span className="size-(--space-3) bg-current" />
      Active
    </Badge>
  );
}

function OfferPrice({ offer }: { offer: BillingOffer }) {
  return (
    <span className="font-mono text-[length:var(--text-xs)] text-[var(--color-ink-soft)]">
      <span className="text-[length:var(--text-sm)] font-semibold text-[var(--color-ink)]">
        ${offer.monthlyUsd}
      </span>
      /mo
    </span>
  );
}

export function BillingSection({
  initialData,
  checkoutSuccess,
}: {
  initialData: BillingPageData;
  checkoutSuccess: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(checkoutSuccess);
  const [pending, setPending] = useState<string | null>(null);
  const periodEnd = formatDate(initialData.currentPeriodEnd);
  const entitlements = initialData.entitlements;
  const hasSubscription =
    Boolean(initialData.stripeSubscriptionId) && initialData.status !== "canceled";

  const runBillingAction = useCallback(
    async (action: "portal" | "resync") => {
      setError(null);
      setPending(action);

      try {
        const response = await apiJson<BillingActionResponse>(
          `/api/billing/${action}`,
          { method: "POST", fallbackError: "Billing request failed." }
        );

        if (response.url) {
          window.location.assign(response.url);
          return;
        }

        window.location.reload();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Billing request failed.");
        setIsProcessing(false);
      } finally {
        setPending(null);
      }
    },
    []
  );

  const startCheckout = useCallback(async (lookupKey: string) => {
    setError(null);
    setPending(lookupKey);

    try {
      const response = await apiJson<BillingActionResponse>("/api/billing/checkout", {
        method: "POST",
        idempotencyKey: `billing-checkout-${lookupKey}`,
        body: { lookupKey },
        fallbackError: "Checkout failed.",
      });

      if (response.url) {
        window.location.assign(response.url);
        return;
      }

      window.location.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Checkout failed.");
    } finally {
      setPending(null);
    }
  }, []);

  useEffect(() => {
    if (!checkoutSuccess) return;

    const timeout = window.setTimeout(() => {
      window.location.replace("/settings/billing");
    }, 2500);

    return () => window.clearTimeout(timeout);
  }, [checkoutSuccess]);

  const renewal = initialData.cancelAtPeriodEnd
    ? `ends ${periodEnd ?? "at period end"}`
    : periodEnd
      ? `renews ${periodEnd}`
      : null;

  const offerAction = (offer: BillingOffer) => {
    if (offerIncluded(offer, entitlements)) {
      return <Badge variant="success">Included</Badge>;
    }
    return (
      <div className="flex items-center gap-(--space-5)">
        <OfferPrice offer={offer} />
        <Button
          variant="outline"
          size="sm"
          onClick={() => void startCheckout(offer.lookupKey)}
          disabled={
            !initialData.checkoutConfigured || hasSubscription || pending != null
          }
        >
          Add
        </Button>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-(--space-8)">
      <SettingsPageHeader
        title="Billing"
        sub="Plugins for your Ashicore workspace. Invoices and payment methods are managed in Stripe."
        action={
          hasSubscription ? (
            <Button
              onClick={() => void runBillingAction("portal")}
              disabled={!initialData.billingConfigured || pending != null}
            >
              <HugeiconsIcon icon={CreditCardIcon} data-icon="inline-start" />
              Manage subscription
            </Button>
          ) : null
        }
      />

      <SettingsCard>
        {isProcessing ? (
          <SettingsBlock>
            <div className="flex items-start gap-(--space-4) text-[length:var(--text-sm)]">
              <HugeiconsIcon
                icon={RefreshIcon}
                className="mt-(--space-1) size-(--space-7)"
                strokeWidth={2}
              />
              <div>
                <div className="font-medium">Payment processing</div>
                <div className="mt-(--space-1) text-[var(--color-ink-faint)]">
                  Stripe is confirming the subscription. This page will refresh shortly.
                </div>
              </div>
            </div>
          </SettingsBlock>
        ) : null}

        {initialData.cancelAtPeriodEnd ? (
          <SettingsBlock>
            <div className="flex items-start gap-(--space-4) text-[length:var(--text-sm)]">
              <HugeiconsIcon
                icon={Alert02Icon}
                className="mt-(--space-1) size-(--space-7) text-[var(--status-danger-ink)]"
                strokeWidth={2}
              />
              <div>
                <div className="font-medium">
                  Subscription ends {periodEnd ?? "at period end"}
                </div>
                <div className="mt-(--space-1) text-[var(--color-ink-faint)]">
                  You keep all current data; paid plugin workflows pause when the
                  subscription ends.
                </div>
              </div>
            </div>
          </SettingsBlock>
        ) : null}

        {initialData.status === "past_due" ? (
          <SettingsBlock>
            <div className="flex items-start gap-(--space-4) text-[length:var(--text-sm)]">
              <HugeiconsIcon
                icon={Alert02Icon}
                className="mt-(--space-1) size-(--space-7) text-[var(--status-danger-ink)]"
                strokeWidth={2}
              />
              <div>
                <div className="font-medium">Payment needs attention</div>
                <div className="mt-(--space-1) text-[var(--color-ink-faint)]">
                  Update the payment method in Stripe to avoid an involuntary downgrade.
                </div>
              </div>
            </div>
          </SettingsBlock>
        ) : null}

        {error ? (
          <SettingsBlock>
            <FieldError>{error}</FieldError>
          </SettingsBlock>
        ) : null}

        <SettingsBlock>
          <div className="flex min-w-0 flex-col gap-(--space-3)">
            <div className="flex items-center gap-(--space-5)">
              <span className="text-[length:var(--text-xl)] leading-[var(--leading-xl)] font-semibold tracking-[var(--tracking-tight)] text-[var(--color-ink)]">
                {describeCurrentPlan(entitlements)}
              </span>
              {hasSubscription || initialData.status === "past_due" ? (
                <PlanStatusBadge data={initialData} />
              ) : null}
            </div>
            <span className="text-[length:var(--text-xs)] text-[var(--color-ink-faint)]">
              {entitlements.length === 0
                ? `Unlimited SKUs, users, and orders · ${initialData.skuCount} SKUs in use`
                : [
                    `Unlimited SKUs · ${initialData.skuCount} in use`,
                    renewal,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
            </span>
          </div>
        </SettingsBlock>
      </SettingsCard>

      <SettingsCard>
        <SettingsBlock>
          <div className="text-[length:var(--text-sm)] font-medium">Plugins</div>
          <div className="mt-(--space-1) text-[length:var(--text-xs)] text-[var(--color-ink-faint)]">
            Add a single workflow when you need it.
          </div>
        </SettingsBlock>
        {BILLING_CATALOG.filter((offer) => offer.kind === "plugin").map((offer) => (
          <SettingsBlock key={offer.lookupKey}>
            <SettingsQuietRow
              title={offer.name}
              sub={offer.blurb}
              action={offerAction(offer)}
            />
          </SettingsBlock>
        ))}
      </SettingsCard>

      <SettingsCard>
        <SettingsBlock>
          <div className="text-[length:var(--text-sm)] font-medium">Packages</div>
          <div className="mt-(--space-1) text-[length:var(--text-xs)] text-[var(--color-ink-faint)]">
            Three plugins picked for your kind of operation, or everything at once.
          </div>
        </SettingsBlock>
        {BILLING_CATALOG.filter((offer) => offer.kind !== "plugin").map((offer) => (
          <SettingsBlock key={offer.lookupKey}>
            <SettingsQuietRow
              title={offer.name}
              sub={offer.blurb}
              action={offerAction(offer)}
            />
          </SettingsBlock>
        ))}
        {hasSubscription ? (
          <SettingsBlock>
            <div className="text-[length:var(--text-xs)] text-[var(--color-ink-faint)]">
              Changing an active subscription in-app is coming next; until then,
              manage it in Stripe or contact support@ashicore.app.
            </div>
          </SettingsBlock>
        ) : null}
      </SettingsCard>

      <SettingsCard>
        <SettingsBlock>
          <SettingsQuietRow
            title="Advantage"
            sub="Multi-site operations, custom roles and onboarding support. No self-serve upgrade yet — talk to us."
            action={
              <Button variant="outline" size="sm" asChild>
                <a href="mailto:support@ashicore.app?subject=Ashicore%20Advantage">
                  Contact sales
                </a>
              </Button>
            }
          />
        </SettingsBlock>
      </SettingsCard>

      <SettingsFootnote>
        Plan out of date?{" "}
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto p-0 text-[length:var(--text-xs)]"
          onClick={() => void runBillingAction("resync")}
          disabled={!initialData.billingConfigured || pending != null}
        >
          <HugeiconsIcon icon={RefreshIcon} data-icon="inline-start" />
          Resync with Stripe
        </Button>
      </SettingsFootnote>
    </div>
  );
}
