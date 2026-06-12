import { redirect } from "next/navigation";
import { hasModuleAccess } from "@/lib/authz";
import { requireModuleReadAccess } from "@/lib/dal/auth";
import { getFeatureAccessForCurrentOrg } from "@/lib/billing/dal";
import { getStocktake, getStocktakePreviewItems } from "../queries";
import { StocktakeDetail } from "../stocktake-detail";

export default async function StocktakeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const context = await requireModuleReadAccess("inventory");
  const { id } = await params;
  const [stocktake, lotAccess] = await Promise.all([
    getStocktake(id),
    getFeatureAccessForCurrentOrg("lot_tracking"),
  ]);

  if (!stocktake) {
    redirect("/inventory/stocktakes");
  }

  // Preview quantities seed expectedQty when adding items, so they must read
  // at the stocktake's stamped location.
  const previewItems = await getStocktakePreviewItems(stocktake.locationId);

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
      previewItems={previewItems}
      canViewLedger={hasModuleAccess(context.assignedRoles, "inventory", "read")}
      lotTrackingLocked={lotAccess.locked}
    />
  );
}
