import { Suspense } from "react";
import { DataTable } from "../data-table";
import DataTableLoading from "../data-table-loading";
import { getItems } from "@/lib/inventory/queries/items-list";
import { getAuthedMemberContext } from "@/lib/dal/auth";

export default function MaterialsPage() {
  return (
    <Suspense fallback={<DataTableLoading />}>
      <MaterialsData />
    </Suspense>
  );
}

async function MaterialsData() {
  const [context, items] = await Promise.all([
    getAuthedMemberContext(),
    getItems({ itemType: "material" }),
  ]);

  return (
    <DataTable
      initialData={items}
      itemType="material"
      organizationId={context.orgId}
    />
  );
}
