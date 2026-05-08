import { PricingScheduleForm } from "@/app/(dashboard)/sales/pricing-schedule-form";
import {
  getCustomerCategoryOptions,
  getPricingUnitOptions,
} from "@/app/(dashboard)/sales/queries";

export default async function NewPricingSchedulePage() {
  const [customerCategories, units] = await Promise.all([
    getCustomerCategoryOptions(),
    getPricingUnitOptions(),
  ]);

  return <PricingScheduleForm customerCategories={customerCategories} units={units} />;
}
