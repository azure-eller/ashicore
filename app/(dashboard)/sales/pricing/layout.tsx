import { requireModuleAccess } from "@/lib/dal/auth";

export default async function SalesPricingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireModuleAccess("sales", "admin");

  return children;
}
