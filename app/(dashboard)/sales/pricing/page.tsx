import { requireModuleReadAccess } from "@/lib/dal/auth";
import {
  getCustomerCategories,
  getPricingSchedules,
} from "@/app/(dashboard)/sales/queries";
import { CustomerCategoriesTable } from "@/app/(dashboard)/sales/customer-categories-table";
import { PricingSchedulesTable } from "@/app/(dashboard)/sales/pricing-schedules-table";

export default async function PricingPage() {
  await requireModuleReadAccess("sales");
  const [customerCategories, pricingSchedules] = await Promise.all([
    getCustomerCategories(),
    getPricingSchedules(),
  ]);

  return (
    <div className="mx-auto w-full max-w-7xl space-y-10 p-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Pricing</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Manage customer categories and the quantity-discount schedules used to
          suggest sales order pricing.
        </p>
      </div>

      <section className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold tracking-tight">
            Customer Categories
          </h2>
          <p className="text-sm text-muted-foreground">
            Assign customers to one category, then target schedules at that category.
          </p>
        </div>
        <CustomerCategoriesTable initialData={customerCategories} />
      </section>

      <section className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold tracking-tight">
            Pricing Schedules
          </h2>
          <p className="text-sm text-muted-foreground">
            One schedule applies to one customer scope and one unit/package type.
          </p>
        </div>
        <PricingSchedulesTable initialData={pricingSchedules} />
      </section>
    </div>
  );
}
