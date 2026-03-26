import { ManufacturingHeader } from "./manufacturing-header";

export default function ManufacturingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <ManufacturingHeader />
      <div className="flex flex-1 flex-col gap-4 p-4 pt-0">{children}</div>
    </>
  );
}
