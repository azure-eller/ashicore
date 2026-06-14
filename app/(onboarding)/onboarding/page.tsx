import { redirect } from "next/navigation";
import { hasModuleAccess } from "@/lib/authz";
import { getAuthedMemberContext } from "@/lib/dal/auth";
import { OnboardingImportPage } from "./onboarding-import-page";
import { isBillingSelection } from "@/lib/billing/plan-intent";

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string }>;
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
  const { plan } = await searchParams;
  const billingSelection = isBillingSelection(plan) ? plan : undefined;
  return <OnboardingImportPage plan={billingSelection} />;
}
