import { requireModuleAccess } from "@/lib/dal/auth";
import { getStocktakePreviewItems, getStocktakeScopeOptions } from "../queries";
import { StocktakeForm } from "../stocktake-form";

export default async function NewStocktakePage() {
  await requireModuleAccess("inventory", "operate");
  const [scopeGroups, previewItems] = await Promise.all([
    getStocktakeScopeOptions(),
    getStocktakePreviewItems(),
  ]);

  return <StocktakeForm scopeGroups={scopeGroups} previewItems={previewItems} />;
}
