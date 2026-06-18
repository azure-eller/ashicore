import { Suspense } from "react";
import { DataTable } from "../data-table";
import DataTableLoading from "../data-table-loading";
import { getItems } from "@/lib/inventory/queries/items-list";
import { getAuthedMemberContext } from "@/lib/dal/auth";
import { hasModuleAccess } from "@/lib/authz";

export default function ProductsPage() {
  return (
    <Suspense fallback={<DataTableLoading />}>
      <ProductsData />
    </Suspense>
  );
}

async function ProductsData() {
  const [context, items] = await Promise.all([
    getAuthedMemberContext(),
    getItems({ itemType: "product" }),
  ]);

  return (
    <DataTable
      initialData={items}
      itemType="product"
      organizationId={context.orgId}
      canOperateInventory={hasModuleAccess(context.assignedRoles, "inventory", "operate")}
    />
  );
}
