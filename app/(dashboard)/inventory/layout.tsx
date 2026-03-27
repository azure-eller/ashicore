import { requireModuleReadAccess } from "@/lib/dal/auth";
import { InventoryHeader } from "./inventory-header";

export default async function InventoryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireModuleReadAccess("inventory");

  return (
    <>
      <InventoryHeader />
      <div className="flex flex-1 flex-col gap-4 p-4 pt-0">{children}</div>
    </>
  );
}
