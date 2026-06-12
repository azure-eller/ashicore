"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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

export function BillingSection({
  initialData,
  autoCheckout,
  checkoutSuccess,
}: {
  initialData: BillingPageData;
  autoCheckout: boolean;
  checkoutSuccess: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(checkoutSuccess);
  const [isPending, setIsPending] = useState<"checkout" | "portal" | "resync" | null>(
    null
  );
  const autoCheckoutStarted = useRef(false);
  const periodEnd = formatDate(initialData.currentPeriodEnd);
  const isCore = initialData.plan === "core";

  const runBillingAction = useCallback(
    async (action: "checkout" | "portal" | "resync") => {
      setError(null);
      setIsPending(action);

      try {
        const response = await apiJson<BillingActionResponse>(
          `/api/billing/${action}`,
          {
            method: "POST",
            idempotencyKey: action === "checkout" ? "billing-checkout" : undefined,
            fallbackError: "Billing request failed.",
          }
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
        setIsPending(null);
      }
    },
    []
  );

  useEffect(() => {
    if (!checkoutSuccess) return;

    const timeout = window.setTimeout(() => {
      window.location.replace("/settings/billing");
    }, 2500);

    return () => window.clearTimeout(timeout);
  }, [checkoutSuccess]);

  useEffect(() => {
    if (
      !autoCheckout ||
      autoCheckoutStarted.current ||
      checkoutSuccess ||
      initialData.plan !== "free"
    ) {
      return;
    }

    autoCheckoutStarted.current = true;
    void runBillingAction("checkout");
  }, [autoCheckout, checkoutSuccess, initialData.plan, runBillingAction]);

  const skuUsage = `Unlimited SKUs · ${initialData.skuCount} in use`;
  const renewal = initialData.cancelAtPeriodEnd
    ? `ends ${periodEnd ?? "at period end"}`
    : periodEnd
      ? `renews ${periodEnd}`
      : "renews monthly";

  return (
    <div className="flex flex-col gap-(--space-8)">
      <SettingsPageHeader
        title="Billing"
        sub="Your Ashicore subscription. Invoices and payment methods are managed in Stripe."
        action={
          initialData.plan === "free" ? (
            <Button
              onClick={() => void runBillingAction("checkout")}
              disabled={!initialData.checkoutConfigured || isPending != null}
            >
              <HugeiconsIcon icon={CreditCardIcon} data-icon="inline-start" />
              Upgrade to Core
            </Button>
          ) : (
            <Button
              onClick={() => void runBillingAction("portal")}
              disabled={!initialData.billingConfigured || isPending != null}
            >
              <HugeiconsIcon icon={CreditCardIcon} data-icon="inline-start" />
              Manage subscription
            </Button>
          )
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
                <div className="font-medium">Core ends {periodEnd ?? "at period end"}</div>
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
                {isCore ? "Core" : "Free"}
              </span>
              <PlanStatusBadge data={initialData} />
            </div>
            {isCore ? (
              <span className="font-mono text-[length:var(--text-xs)] text-[var(--color-ink-soft)]">
                <span className="text-[length:var(--text-sm)] font-semibold text-[var(--color-ink)]">
                  $199
                </span>{" "}
                / month
              </span>
            ) : null}
            <span className="text-[length:var(--text-xs)] text-[var(--color-ink-faint)]">
              {isCore ? `${skuUsage} · ${renewal}` : skuUsage}
            </span>
          </div>
        </SettingsBlock>

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
          disabled={!initialData.billingConfigured || isPending != null}
        >
          <HugeiconsIcon icon={RefreshIcon} data-icon="inline-start" />
          Resync with Stripe
        </Button>
      </SettingsFootnote>
    </div>
  );
}
