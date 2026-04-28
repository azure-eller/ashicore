import { Suspense } from "react";
import { requireModuleReadAccess } from "@/lib/dal/auth";
import { getInventoryTabCounts } from "./queries";
import { InventoryHeader } from "./inventory-header";

export default async function InventoryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireModuleReadAccess("inventory");

  return (
    <>
      <Suspense fallback={<InventoryHeader />}>
        <InventoryHeaderWithCounts />
      </Suspense>
      <div className="flex flex-1 flex-col gap-4 p-4 pt-0">{children}</div>
    </>
  );
}

async function InventoryHeaderWithCounts() {
  const counts = await getInventoryTabCounts();

  return <InventoryHeader counts={counts} />;
}
