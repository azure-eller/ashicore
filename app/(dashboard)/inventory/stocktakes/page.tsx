import { Suspense } from "react";
import DataTableSkeleton from "./data-table-skeleton";
import { getStocktakes } from "./queries";
import { StocktakesTable } from "./stocktakes-table";

export default function StocktakesPage() {
  return (
    <Suspense fallback={<DataTableSkeleton />}>
      <StocktakesData />
    </Suspense>
  );
}

async function StocktakesData() {
  const stocktakes = await getStocktakes();
  return <StocktakesTable initialData={stocktakes} />;
}
