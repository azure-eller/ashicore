import { requireModuleAccess } from "@/lib/dal/auth";
import { StocktakeForm } from "../stocktake-form";

export default async function NewStocktakePage() {
  await requireModuleAccess("inventory", "operate");
  return <StocktakeForm />;
}
