import { DashboardModuleShell } from "@/components/dashboard-shell";
import { requireModuleReadAccess } from "@/lib/dal/auth";

export default async function SalesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireModuleReadAccess("sales");

  return <DashboardModuleShell>{children}</DashboardModuleShell>;
}
