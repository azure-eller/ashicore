import { PurchasingHeader } from "./purchasing-header";

export default function PurchasingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <PurchasingHeader />
      <div className="flex flex-1 flex-col gap-4 p-4 pt-0">{children}</div>
    </>
  );
}
