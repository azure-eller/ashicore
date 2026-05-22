import { redirect } from "next/navigation";
import { requireModuleAccess } from "@/lib/dal/auth";
import { stocktakeDefaultValues } from "@/lib/schemas/stocktakes";
import { buildStocktakeName } from "../types";
import { createStocktake } from "../queries";

export default async function NewStocktakePage() {
  await requireModuleAccess("inventory", "operate");
  const stocktake = await createStocktake({
    ...stocktakeDefaultValues,
    name: buildStocktakeName(stocktakeDefaultValues.scope),
  });
  redirect(`/inventory/stocktakes/${stocktake.id}`);
}
