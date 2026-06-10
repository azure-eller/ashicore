import { redirect } from "next/navigation";
import { PricingScheduleForm } from "@/app/(dashboard)/sales/pricing-schedule-form";
import { getCustomerCategoryOptions } from "@/lib/sales/queries/customer-categories";
import { getPricingScheduleItemOptions, getPricingSchedule } from "@/lib/sales/queries/pricing";

export default async function EditPricingSchedulePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [pricingSchedule, customerCategories, itemOptions] = await Promise.all([
    getPricingSchedule(id),
    getCustomerCategoryOptions(),
    getPricingScheduleItemOptions(),
  ]);

  if (!pricingSchedule) {
    redirect("/sales/pricing");
  }

  return (
    <PricingScheduleForm
      initialData={pricingSchedule}
      customerCategories={customerCategories}
      itemOptions={itemOptions}
    />
  );
}
