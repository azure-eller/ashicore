import { requireModuleReadAccess } from "@/lib/dal/auth";
import { PurchasingHeader } from "./purchasing-header";

export default async function PurchasingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireModuleReadAccess("purchasing");

  return (
    <>
      <PurchasingHeader />
      <div className="flex flex-1 flex-col gap-4 p-4 pt-0">{children}</div>
    </>
  );
}
