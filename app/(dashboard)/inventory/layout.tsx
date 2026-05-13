import { requireModuleReadAccess } from "@/lib/dal/auth";

export default async function InventoryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireModuleReadAccess("inventory");

  return (
    <div className="flex flex-1 flex-col gap-4 p-4">{children}</div>
  );
}
