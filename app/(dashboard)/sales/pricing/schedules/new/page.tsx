import { PricingScheduleForm } from "@/app/(dashboard)/sales/pricing-schedule-form";
import { getCustomerCategoryOptions } from "@/lib/sales/queries/customer-categories";
import { getPricingScheduleItemOptions } from "@/lib/sales/queries/pricing";

export default async function NewPricingSchedulePage() {
  const [customerCategories, itemOptions] = await Promise.all([
    getCustomerCategoryOptions(),
    getPricingScheduleItemOptions(),
  ]);

  return (
    <PricingScheduleForm
      customerCategories={customerCategories}
      itemOptions={itemOptions}
    />
  );
}
