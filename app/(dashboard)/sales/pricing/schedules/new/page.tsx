import { requireModuleWriteAccess } from "@/lib/dal/auth";
import { PricingScheduleForm } from "@/app/(dashboard)/sales/pricing-schedule-form";
import {
  getCustomerCategoryOptions,
  getPricingUnitOptions,
} from "@/app/(dashboard)/sales/queries";

export default async function NewPricingSchedulePage() {
  await requireModuleWriteAccess("sales");
  const [customerCategories, units] = await Promise.all([
    getCustomerCategoryOptions(),
    getPricingUnitOptions(),
  ]);

  return (
    <div className="mx-auto w-full max-w-5xl py-8">
      <PricingScheduleForm customerCategories={customerCategories} units={units} />
    </div>
  );
}
