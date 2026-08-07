"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert02Icon, CreditCardIcon, RefreshIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import {
  SettingsBlock,
  SettingsCard,
  SettingsPageHeader,
  SettingsQuietRow,
} from "@/components/settings-panel";
import { apiJson } from "@/lib/client/api";
import { PRO_MONTHLY_USD, PRO_PLAN_LOOKUP_KEY } from "@/lib/billing/types";
import type { BillingPageData } from "./types";

type BillingActionResponse = { url?: string };

function formatDate(value: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
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
  const hasSubscription = Boolean(initialData.stripeSubscriptionId);
  const periodEnd = formatDate(initialData.currentPeriodEnd);
  const graceEnd = formatDate(initialData.skuLimitStartsAt);
  const isGraceActive =
    initialData.plan === "free" &&
    new Date(initialData.skuLimitStartsAt).getTime() > Date.now();
  const overLimit = initialData.skuLimit != null && initialData.skuCount > initialData.skuLimit;

  const runBillingAction = useCallback(
    async (action: "portal" | "cancel_at_period_end" | "resume") => {
      setError(null);
      setPending(action);
      try {
        const response =
          action === "portal"
            ? await apiJson<BillingActionResponse>("/api/billing/portal", {
                method: "POST",
                fallbackError: "Billing request failed.",
              })
            : await apiJson<BillingActionResponse>("/api/billing/subscription", {
                method: "POST",
                idempotencyKey: `billing-${action}`,
                body: { action },
                fallbackError: "Billing request failed.",
              });

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

  const startPro = useCallback(async () => {
    setError(null);
    setPending(PRO_PLAN_LOOKUP_KEY);
    try {
      const response = await apiJson<BillingActionResponse>("/api/billing/checkout", {
        method: "POST",
        idempotencyKey: `billing-checkout-${PRO_PLAN_LOOKUP_KEY}`,
        body: { lookupKey: PRO_PLAN_LOOKUP_KEY },
        fallbackError: "Checkout failed.",
      });
      if (response.url) window.location.assign(response.url);
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

  return (
    <div className="flex flex-col gap-(--space-8)">
      <SettingsPageHeader
        title="Billing"
        sub="Free includes the complete ERP for up to 30 active SKUs. Pro removes the SKU limit."
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
              <HugeiconsIcon icon={RefreshIcon} className="mt-(--space-1) size-(--space-7)" />
              <div>
                <div className="font-medium">Payment processing</div>
                <div className="mt-(--space-1) text-[var(--color-ink-faint)]">
                  Stripe is confirming Pro. This page will refresh shortly.
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
              />
              <div>
                <div className="font-medium">Pro ends {periodEnd ?? "at period end"}</div>
                <div className="mt-(--space-1) text-[var(--color-ink-faint)]">
                  Your data and workflows stay available. Free prevents adding more SKUs when more than 30 are active.
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
              />
              <div>
                <div className="font-medium">Payment needs attention</div>
                <div className="mt-(--space-1) text-[var(--color-ink-faint)]">
                  Pro remains available while Stripe retries payment.
                </div>
              </div>
            </div>
          </SettingsBlock>
        ) : null}

        {error ? <SettingsBlock><FieldError>{error}</FieldError></SettingsBlock> : null}

        <SettingsBlock>
          <div className="flex min-w-0 flex-col gap-(--space-4)">
            <div className="flex flex-wrap items-center justify-between gap-(--space-5)">
              <div className="flex items-center gap-(--space-5)">
                <span className="text-[length:var(--text-xl)] font-semibold tracking-[var(--tracking-tight)]">
                  {initialData.plan === "pro" ? "Pro" : "Free"}
                </span>
                <Badge variant={initialData.status === "past_due" ? "destructive" : "success"}>
                  {initialData.status === "past_due" ? "Payment past due" : "Active"}
                </Badge>
              </div>
              {hasSubscription ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void runBillingAction(initialData.cancelAtPeriodEnd ? "resume" : "cancel_at_period_end")}
                  disabled={!initialData.billingConfigured || pending != null}
                >
                  {initialData.cancelAtPeriodEnd ? "Resume" : "Cancel renewal"}
                </Button>
              ) : null}
            </div>
            <span className="text-[length:var(--text-xs)] text-[var(--color-ink-faint)]">
              {initialData.plan === "pro"
                ? `Unlimited SKUs · ${initialData.skuCount} active${periodEnd ? ` · renews ${periodEnd}` : ""}`
                : `${initialData.skuCount}/30 active SKUs${isGraceActive && graceEnd ? ` · unlimited creation until ${graceEnd}` : ""}`}
            </span>
            {overLimit ? (
              <span className="text-[length:var(--text-xs)] text-[var(--status-danger-ink)]">
                Existing SKUs remain usable, but new SKUs require Pro or reducing the active catalog to 30.
              </span>
            ) : null}
          </div>
        </SettingsBlock>
      </SettingsCard>

      {initialData.plan === "free" ? (
        <SettingsCard>
          <SettingsBlock>
            <SettingsQuietRow
              title="Pro"
              sub="The complete Ashicore ERP with unlimited SKUs, users, integrations, and locations."
              action={
                <div className="flex items-center gap-(--space-5)">
                  <span className="font-mono text-[length:var(--text-xs)] text-[var(--color-ink-soft)]">
                    <span className="text-[length:var(--text-sm)] font-semibold text-[var(--color-ink)]">
                      ${PRO_MONTHLY_USD}
                    </span>/mo
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void startPro()}
                    disabled={!initialData.checkoutConfigured || pending != null}
                  >
                    Start Pro
                  </Button>
                </div>
              }
            />
          </SettingsBlock>
        </SettingsCard>
      ) : null}

    </div>
  );
}
