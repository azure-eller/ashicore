import { requireModuleReadAccess } from "@/lib/dal/auth";

export default async function SalesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireModuleReadAccess("sales");

  return (
    <div className="flex flex-1 flex-col gap-4 p-4">{children}</div>
  );
}
