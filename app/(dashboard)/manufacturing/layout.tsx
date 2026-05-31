import { DashboardModuleShell } from "@/components/dashboard-shell";
import { requireModuleReadAccess } from "@/lib/dal/auth";

export default async function ManufacturingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireModuleReadAccess("manufacturing");

  return <DashboardModuleShell>{children}</DashboardModuleShell>;
}
