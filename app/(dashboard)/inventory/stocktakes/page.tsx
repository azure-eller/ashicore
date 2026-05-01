import { Suspense } from "react";
import DataTableLoading from "./data-table-loading";
import { getStocktakes } from "./queries";
import { StocktakesTable } from "./stocktakes-table";

export default function StocktakesPage() {
  return (
    <Suspense fallback={<DataTableLoading />}>
      <StocktakesData />
    </Suspense>
  );
}

async function StocktakesData() {
  const stocktakes = await getStocktakes();
  return <StocktakesTable initialData={stocktakes} />;
}
