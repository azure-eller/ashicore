import { requireModuleReadAccess } from "@/lib/dal/auth";
import { SalesHeader } from "./sales-header";

export default async function SalesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireModuleReadAccess("sales");

  return (
    <>
      <SalesHeader />
      <div className="flex flex-1 flex-col gap-4 p-4 pt-0">{children}</div>
    </>
  );
}
