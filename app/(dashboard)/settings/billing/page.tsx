import { redirect } from "next/navigation";
import { canManageTeam } from "@/lib/authz";
import { getAuthedMemberContext } from "@/lib/dal/auth";
import { isCheckoutConfigured, isStripeConfigured } from "@/lib/billing/stripe";
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

  const billing = await getBillingStateForCurrentOrg();
  const params = await searchParams;
  const initialData: BillingPageData = {
    ...billing,
    currentPeriodEnd: billing.currentPeriodEnd?.toISOString() ?? null,
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
