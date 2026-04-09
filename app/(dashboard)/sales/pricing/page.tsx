import { Suspense } from "react";
import { getPricingSchedules } from "@/app/(dashboard)/sales/queries";
import { PricingSchedulesTable } from "@/app/(dashboard)/sales/pricing-schedules-table";
import DataTableSkeleton from "../data-table-skeleton";

export default function PricingPage() {
  return (
    <div className="mx-auto w-full max-w-7xl space-y-10 p-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">
          Pricing Schedules
        </h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Quantity-discount schedules used to suggest sales order pricing.
        </p>
      </div>

      <Suspense fallback={<DataTableSkeleton />}>
        <PricingSchedulesData />
      </Suspense>
    </div>
  );
}

async function PricingSchedulesData() {
  const pricingSchedules = await getPricingSchedules();
  return <PricingSchedulesTable initialData={pricingSchedules} />;
}
