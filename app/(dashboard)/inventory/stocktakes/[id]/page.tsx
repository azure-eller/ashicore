import { redirect } from "next/navigation";
import { hasModuleAccess } from "@/lib/authz";
import { getAuthedMemberContext } from "@/lib/dal/auth";
import { getStocktake, getStocktakePreviewItems, getStocktakeScopeOptions } from "../queries";
import { StocktakeDetail } from "../stocktake-detail";

export default async function StocktakeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const context = await getAuthedMemberContext();
  const { id } = await params;
  const [stocktake, scopeGroups, previewItems] = await Promise.all([
    getStocktake(id),
    getStocktakeScopeOptions(),
    getStocktakePreviewItems(),
  ]);

  if (!stocktake) {
    redirect("/inventory/stocktakes");
  }

  return (
    <StocktakeDetail
      key={stocktake.lines
        .map((line) =>
          [
            line.id,
            line.expectedQty,
            line.countedQty ?? "",
            ...line.lots.map(
              (lot) => `${lot.id}:${lot.expectedQty}:${lot.countedQty ?? ""}`
            ),
          ].join(":")
        )
        .join("|")}
      stocktake={stocktake}
      scopeGroups={scopeGroups}
      previewItems={previewItems}
      canViewLedger={hasModuleAccess(context.assignedRoles, "inventory", "read")}
    />
  );
}
