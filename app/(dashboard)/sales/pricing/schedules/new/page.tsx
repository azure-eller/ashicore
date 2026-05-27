import { PricingScheduleForm } from "@/app/(dashboard)/sales/pricing-schedule-form";
import {
  getCustomerCategoryOptions,
  getPricingItemCategoryOptions,
} from "@/app/(dashboard)/sales/queries";

export default async function NewPricingSchedulePage() {
  const [customerCategories, itemCategories] = await Promise.all([
    getCustomerCategoryOptions(),
    getPricingItemCategoryOptions(),
  ]);

  return (
    <PricingScheduleForm
      customerCategories={customerCategories}
      itemCategories={itemCategories}
    />
  );
}
