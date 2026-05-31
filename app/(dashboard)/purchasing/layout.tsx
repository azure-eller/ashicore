import { DashboardModuleShell } from "@/components/dashboard-shell";
import { requireModuleReadAccess } from "@/lib/dal/auth";

export default async function PurchasingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireModuleReadAccess("purchasing");

  return <DashboardModuleShell>{children}</DashboardModuleShell>;
}
