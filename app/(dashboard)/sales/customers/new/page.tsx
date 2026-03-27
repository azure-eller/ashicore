import { requireModuleWriteAccess } from "@/lib/dal/auth";
import { CustomerForm } from "@/app/(dashboard)/sales/customer-form";

export default async function NewCustomerPage() {
  await requireModuleWriteAccess("sales");
  return (
    <div className="mx-auto w-full max-w-4xl py-8">
      <CustomerForm />
    </div>
  );
}
