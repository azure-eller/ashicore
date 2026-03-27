import { requireModuleReadAccess } from "@/lib/dal/auth";
import { ManufacturingHeader } from "./manufacturing-header";

export default async function ManufacturingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireModuleReadAccess("manufacturing");

  return (
    <>
      <ManufacturingHeader />
      <div className="flex flex-1 flex-col gap-4 p-4 pt-0">{children}</div>
    </>
  );
}
