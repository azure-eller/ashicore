import { DashboardModuleShell } from "@/components/dashboard-shell";
import { requireModuleReadAccess } from "@/lib/dal/auth";

export default async function InventoryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireModuleReadAccess("inventory");

  return <DashboardModuleShell>{children}</DashboardModuleShell>;
}
