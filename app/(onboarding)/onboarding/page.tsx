import { redirect } from "next/navigation";
import { hasModuleAccess } from "@/lib/authz";
import { getAuthedMemberContext } from "@/lib/dal/auth";
import { getQuickBooksConnection } from "@/lib/dal/accounting";
import { getShopifyConnection } from "@/lib/dal/shopify";
import { getXeroConnection } from "@/lib/dal/xero";
import { OnboardingImportPage } from "./onboarding-import-page";
import {
  isBillingSelection,
  normalizeBillingIntent,
} from "@/lib/billing/plan-intent";

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string; locations?: string; addons?: string }>;
}) {
  const context = await getAuthedMemberContext();
  const canImport =
    context.role === "owner" ||
    (hasModuleAccess(context.assignedRoles, "inventory", "admin") &&
      hasModuleAccess(context.assignedRoles, "sales", "admin") &&
      hasModuleAccess(context.assignedRoles, "purchasing", "admin"));

  if (!canImport) {
    redirect("/");
  }

  // Pass the billing selection only when the URL actually carries it. On the Stripe
  // return (`?checkout=success`) there is no plan param, so we leave it undefined
  // and let the persisted onboarding session remain the source of truth.
  const params = await searchParams;
  const { plan } = params;
  const billingSelection = isBillingSelection(plan) ? plan : undefined;
  const billingIntent = billingSelection
    ? normalizeBillingIntent(params)
    : undefined;
  const [xeroConnection, quickBooksConnection, shopifyConnection] =
    await Promise.all([
      getXeroConnection(),
      getQuickBooksConnection(),
      getShopifyConnection(),
    ]);

  return (
    <OnboardingImportPage
      plan={billingSelection}
      initialBillingIntent={billingIntent}
      integrations={{
        xero: xeroConnection
          ? { connected: true, tenantName: xeroConnection.tenantName }
          : { connected: false },
        quickbooks: quickBooksConnection
          ? { connected: true, tenantName: quickBooksConnection.tenantName }
          : { connected: false },
        shopify: shopifyConnection
          ? { connected: true, tenantName: shopifyConnection.shopDomain }
          : { connected: false },
      }}
    />
  );
}
