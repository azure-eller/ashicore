import { redirect } from "next/navigation";
import { hasModuleAccess } from "@/lib/authz";
import { getAuthedMemberContext } from "@/lib/dal/auth";
import { getStocktake } from "../queries";
import { StocktakeDetail } from "../stocktake-detail";

export default async function StocktakeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const context = await getAuthedMemberContext();
  const { id } = await params;
  const stocktake = await getStocktake(id);

  if (!stocktake) {
    redirect("/inventory/stocktakes");
  }

  return (
    <StocktakeDetail
      stocktake={stocktake}
      canViewLedger={hasModuleAccess(context.assignedRoles, "inventory", "read")}
    />
  );
}
