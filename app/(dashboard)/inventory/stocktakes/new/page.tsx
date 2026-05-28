import { requireModuleAccess } from "@/lib/dal/auth";
import { getStocktakes } from "../queries";
import { CreateStocktakeClient } from "./create-stocktake-client";

export default async function NewStocktakePage() {
  await requireModuleAccess("inventory", "operate");
  const stocktakes = await getStocktakes({ limit: 25 });
  return <CreateStocktakeClient stocktakes={stocktakes} />;
}
