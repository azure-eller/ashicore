import { Suspense } from "react";
import { getPricingSchedules } from "@/lib/sales/queries";
import { PricingSchedulesTable } from "@/app/(dashboard)/sales/pricing-schedules-table";
import DataTableLoading from "../data-table-loading";

export default function PricingPage() {
  return (
    <Suspense fallback={<DataTableLoading />}>
      <PricingSchedulesData />
    </Suspense>
  );
}

async function PricingSchedulesData() {
  const pricingSchedules = await getPricingSchedules();
  return <PricingSchedulesTable initialData={pricingSchedules} />;
}
