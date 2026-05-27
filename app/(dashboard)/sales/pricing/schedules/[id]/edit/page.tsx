import { redirect } from "next/navigation";
import { PricingScheduleForm } from "@/app/(dashboard)/sales/pricing-schedule-form";
import {
  getCustomerCategoryOptions,
  getPricingItemCategoryOptions,
  getPricingSchedule,
} from "@/app/(dashboard)/sales/queries";

export default async function EditPricingSchedulePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [pricingSchedule, customerCategories, itemCategories] = await Promise.all([
    getPricingSchedule(id),
    getCustomerCategoryOptions(),
    getPricingItemCategoryOptions(),
  ]);

  if (!pricingSchedule) {
    redirect("/sales/pricing");
  }

  return (
    <div className="mx-auto w-full max-w-5xl py-8">
      <PricingScheduleForm
        initialData={pricingSchedule}
        customerCategories={customerCategories}
        itemCategories={itemCategories}
      />
    </div>
  );
}
