import { requireModuleAccess } from "@/lib/dal/auth";
import { getStocktakeScopeOptions } from "../queries";
import { StocktakeForm } from "../stocktake-form";

export default async function NewStocktakePage() {
  await requireModuleAccess("inventory", "operate");
  const scopeGroups = await getStocktakeScopeOptions();

  return <StocktakeForm scopeGroups={scopeGroups} />;
}
