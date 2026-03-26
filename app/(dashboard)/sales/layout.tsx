import { SalesHeader } from "./sales-header";

export default function SalesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <SalesHeader />
      <div className="flex flex-1 flex-col gap-4 p-4 pt-0">{children}</div>
    </>
  );
}
