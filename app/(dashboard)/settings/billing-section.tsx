"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Alert02Icon, CreditCardIcon, RefreshIcon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { apiJson } from "@/lib/client/api";
import { BILLING_PLUGIN_LABELS, FREE_SKU_LIMIT } from "@/lib/billing/types";
import type { BillingPageData } from "./types";
import {
  SettingsKeyValueRow,
  SettingsPanel,
  SettingsPanelHeader,
  SettingsPanelSection,
  SettingsRows,
} from "@/components/settings-panel";

type BillingActionResponse = {
  url?: string;
};

function formatPlan(plan: BillingPageData["plan"]) {
  return plan === "core" ? "Core" : "Free";
}

function formatStatus(data: BillingPageData) {
  if (data.cancelAtPeriodEnd) return "Ends at period end";
  if (data.status === "past_due") return "Payment past due";
  if (data.status === "canceled") return "Canceled";
  return "Active";
}

function formatDate(value: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function usageText(data: BillingPageData) {
  return data.skuLimit == null
    ? `${data.skuCount} SKUs`
    : `${data.skuCount} / ${data.skuLimit} SKUs`;
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

  const primaryAction =
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
    );

  return (
    <SettingsPanel id="billing">
      <SettingsPanelHeader
        title="Billing"
        meta="Manage Ashicore subscription and SKU entitlement."
        action={primaryAction}
      />
      <SettingsRows>
        {isProcessing ? (
          <SettingsPanelSection>
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
          </SettingsPanelSection>
        ) : null}

        {initialData.cancelAtPeriodEnd ? (
          <SettingsPanelSection>
            <div className="flex items-start gap-(--space-4) text-[length:var(--text-sm)]">
              <HugeiconsIcon
                icon={Alert02Icon}
                className="mt-(--space-1) size-(--space-7) text-[var(--status-danger-ink)]"
                strokeWidth={2}
              />
              <div>
                <div className="font-medium">Core ends {periodEnd ?? "at period end"}</div>
                <div className="mt-(--space-1) text-[var(--color-ink-faint)]">
                  You will keep all current data, but will not be able to add new
                  SKUs beyond the Free limit of {FREE_SKU_LIMIT}. You currently have{" "}
                  {initialData.skuCount}.
                </div>
              </div>
            </div>
          </SettingsPanelSection>
        ) : null}

        {initialData.status === "past_due" ? (
          <SettingsPanelSection>
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
          </SettingsPanelSection>
        ) : null}

        {error ? (
          <SettingsPanelSection>
            <div className="text-[length:var(--text-sm)] text-[var(--status-danger-ink)]">{error}</div>
          </SettingsPanelSection>
        ) : null}

        <SettingsKeyValueRow label="Plan" value={formatPlan(initialData.plan)} />
        <SettingsKeyValueRow
          label="Plugins"
          value={
            initialData.entitlements.length > 0
              ? initialData.entitlements
                  .map((plugin) => BILLING_PLUGIN_LABELS[plugin])
                  .join(", ")
              : "No plugins yet"
          }
        />
        <SettingsKeyValueRow label="Status" value={formatStatus(initialData)} />
        <SettingsKeyValueRow label="SKU usage" value={usageText(initialData)} />
        <SettingsKeyValueRow
          label={initialData.cancelAtPeriodEnd ? "Core ends" : "Renews"}
          value={periodEnd ?? "Not scheduled"}
        />
        <SettingsKeyValueRow
          label="Core"
          value="$199 / month"
          supportingText="Unlimited SKUs."
        />
        <SettingsKeyValueRow
          label="Advantage"
          value="Contact sales"
          supportingText="Enterprise plan. No self-serve billing flow in v1."
        />
        <SettingsKeyValueRow
          label="Sync"
          value="Refresh Stripe state"
          action={
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void runBillingAction("resync")}
              disabled={!initialData.billingConfigured || isPending != null}
            >
              <HugeiconsIcon icon={RefreshIcon} data-icon="inline-start" />
              Resync
            </Button>
          }
        />
      </SettingsRows>
    </SettingsPanel>
  );
}
