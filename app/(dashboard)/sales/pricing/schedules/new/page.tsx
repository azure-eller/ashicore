import { PricingScheduleForm } from "@/app/(dashboard)/sales/pricing-schedule-form";
import {
  getCustomerCategoryOptions,
  getPricingScheduleItemOptions,
} from "@/app/(dashboard)/sales/queries";

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
