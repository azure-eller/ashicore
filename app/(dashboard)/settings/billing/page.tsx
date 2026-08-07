import { redirect } from "next/navigation";
import { canManageTeam } from "@/lib/authz";
import { getAuthedMemberContext } from "@/lib/dal/auth";
import { captureAppError } from "@/lib/observability/sentry";
import { reconcileBillingPageState } from "@/lib/billing/page-reconciliation";
import {
  isCheckoutConfigured,
  isStripeConfigured,
  syncOrgBillingFromStripe,
} from "@/lib/billing/stripe";
import { BillingSection } from "../billing-section";
import { getBillingStateForCurrentOrg } from "../queries";
import type { BillingPageData } from "../types";

export default async function SettingsBillingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await getAuthedMemberContext();

  if (!canManageTeam(context.assignedRoles)) {
    redirect("/settings/account");
  }

  const currentBilling = await getBillingStateForCurrentOrg();
  const billing = currentBilling.stripeCustomerId
    ? await reconcileBillingPageState({
        current: currentBilling,
        reconcile: () => syncOrgBillingFromStripe(context.orgId),
        reread: getBillingStateForCurrentOrg,
        onError: (error) =>
          captureAppError(error, {
            source: "billing_page_reconciliation",
            operation: "sync_from_stripe",
          }),
      })
    : currentBilling;
  const params = await searchParams;
  const initialData: BillingPageData = {
    ...billing,
    trialEndsAt: billing.trialEndsAt?.toISOString() ?? null,
    skuLimitStartsAt: billing.skuLimitStartsAt.toISOString(),
    currentPeriodStart: billing.currentPeriodStart?.toISOString() ?? null,
    currentPeriodEnd: billing.currentPeriodEnd?.toISOString() ?? null,
    billingUsagePeriodStart: billing.billingUsagePeriodStart?.toISOString() ?? null,
    billingUsagePeriodEnd: billing.billingUsagePeriodEnd?.toISOString() ?? null,
    billingConfigured: isStripeConfigured(),
    checkoutConfigured: isCheckoutConfigured(),
  };

  return (
    <BillingSection
      initialData={initialData}
      checkoutSuccess={params.success === "1"}
    />
  );
}
