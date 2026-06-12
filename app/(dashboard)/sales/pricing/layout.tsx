import { redirect } from "next/navigation";
import { requireModuleAccess } from "@/lib/dal/auth";
import { getFeatureAccessForCurrentOrg } from "@/lib/billing/dal";

export default async function SalesPricingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireModuleAccess("sales", "admin");
  const access = await getFeatureAccessForCurrentOrg("wholesale_pricing");
  if (access.locked) {
    redirect("/sales/orders");
  }

  return children;
}
