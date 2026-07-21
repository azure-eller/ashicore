import { redirect } from "next/navigation";
import { requireModuleReadAccess } from "@/lib/dal/auth";
import { getFeatureAccessForCurrentOrg } from "@/lib/billing/dal";

export default async function PricingScenariosLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireModuleReadAccess("sales");
  const access = await getFeatureAccessForCurrentOrg("pricing_scenarios");
  if (access.locked) {
    redirect("/sales/orders");
  }

  return children;
}
