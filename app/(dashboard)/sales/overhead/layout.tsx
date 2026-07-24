import { redirect } from "next/navigation";
import { getFeatureAccessForCurrentOrg } from "@/lib/billing/dal";
import { requireModuleReadAccess } from "@/lib/dal/auth";

export default async function OverheadLayout({
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
