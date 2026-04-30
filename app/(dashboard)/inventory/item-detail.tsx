import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { ItemDetailActions } from "./item-detail-actions";
import { LotDispositionActions } from "./lot-disposition-actions";
import { TooltipHeader } from "@/components/tooltip-header";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft01Icon, CircleLock01Icon } from "@hugeicons/core-free-icons";
import { calcStock, ITEM_TYPE_SEGMENTS, itemDetailHref, type ItemType } from "@/app/(dashboard)/inventory/types";
import {
  formatCost,
  formatInventoryDisposition,
  formatMovementType,
  formatPrice,
  formatQuantity,
} from "@/lib/format";
import {
  AVAILABLE_QTY_TOOLTIP,
  ACTUAL_MARGIN_TOOLTIP,
  BACKORDER_QTY_TOOLTIP,
  BATCH_YIELD_TOOLTIP,
  BOM_QTY_PER_BATCH_TOOLTIP,
  BOM_QTY_PER_UNIT_TOOLTIP,
  CALCULATED_STOCK_ALERT_TOOLTIP,
  CALCULATED_STOCK_TOOLTIP,
  CURRENT_STOCK_UNIT_COST_TOOLTIP,
  DEMAND_QTY_TOOLTIP,
  EXPECTED_QTY_TOOLTIP,
  ITEM_CATEGORY_TOOLTIP,
  ITEM_SKU_TOOLTIP,
  ITEM_TYPE_TOOLTIP,
  LEDGER_CHANGE_TOOLTIP,
  LEDGER_LOT_TOOLTIP,
  LOT_DISPOSITION_TOOLTIP,
  LOT_PHYSICAL_TOOLTIP,
  LOT_UNIT_COST_TOOLTIP,
  LOT_NUMBER_TOOLTIP,
  ON_HAND_STOCK_TOOLTIP,
  PURCHASE_CONVERSION_TOOLTIP,
  PURCHASE_PRICE_TOOLTIP,
  PURCHASE_UNIT_TOOLTIP,
  RESERVED_QTY_TOOLTIP,
  SAFETY_STOCK_TOOLTIP,
  SELLING_PRICE_TOOLTIP,
  STOCKING_UNIT_TOOLTIP,
  VARIANT_AXES_TOOLTIP,
} from "@/lib/tooltip-copy";

function formatMarginPercent(value: string | null | undefined) {
  return value == null ? "\u2014" : `${value}%`;
}

interface ItemDetailProps {
  item: {
    id: string;
    name: string;
    displayName?: string;
    sku: string | null;
    category: string | null;
    description: string | null;
    unitName: string | null;
    unitSize: string | null;
    unitUom: string | null;
    purchaseUnitName: string | null;
    purchaseUnitSize: string | null;
    purchaseUnitUom: string | null;
    purchaseToStockFactor: string | null;
    defaultPurchasePrice: string | null;
    currentStockUnitCost: string | null;
    defaultSellingPrice: string | null;
    sellable?: boolean | null;
    stock: string;
    committedQty: string;
    demandQty: string;
    shortageQty: string;
    availableQty: string;
    expectedQty: string;
    safetyStock: string;
    manufacturingMode?: string;
    expectedBatchYield?: string | null;
    isMaster?: boolean;
    variantAxes?: string[] | null;
    parentId?: string | null;
    parentName?: string | null;
    bomLocked?: boolean;
    currentBomRevision?: {
      id: string;
      revisionNumber: number;
      isCurrent: boolean;
      note: string | null;
      createdByName: string | null;
      createdAt: Date;
    } | null;
  };
  itemType: ItemType;
  bom?: {
    id: string;
    componentId: string;
    componentName: string;
    componentItemType: string;
    componentUnit: string;
    quantity: string | null;
    minimumLotAgeDays?: number | null;
  }[];
  lots: {
    id: string;
    lotNumber: string;
    quantity: string;
    costPerUnit: string | null;
    soldQuantity: string | null;
    realizedRevenue: string | null;
    realizedCogs: string | null;
    realizedGrossProfit: string | null;
    realizedMarginPercent: string | null;
    receivedAt: Date;
    dispositionBalances: Array<{
      disposition: "available" | "blocked" | "rejected";
      quantity: string;
    }>;
  }[];
  movements: {
    id: string;
    quantity: string;
    movementType: string | null;
    referenceType: string | null;
    referenceId: string | null;
    lotNumber: string | null;
    createdAt: Date;
  }[];
  usedInParents?: {
    id: string;
    name: string;
    displayName: string;
  }[];
  variants?: {
    id: string;
    name: string;
    sku: string | null;
    stock: string;
    committedQty: string;
    demandQty: string;
    shortageQty: string;
    availableQty: string;
    expectedQty: string;
    safetyStock: string;
    defaultSellingPrice: string | null;
    unit: string | null;
    variantAttrs: Record<string, string> | null;
  }[];
  canEdit?: boolean;
  canViewBom?: boolean;
  canViewLedger?: boolean;
}

export function ItemDetail({
  item,
  itemType,
  bom,
  lots,
  movements,
  usedInParents,
  variants,
  canEdit = false,
  canViewBom = true,
  canViewLedger = false,
}: ItemDetailProps) {
  const isMaster = item.isMaster === true;
  const isVariant = item.parentId != null;
  const headingTitle = item.displayName ?? item.name;
  const calculatedStock = calcStock(item);
  const basePath = `/inventory/${ITEM_TYPE_SEGMENTS[itemType]}`;
  const typeLabel = itemType === "product" ? "Products" : "Materials";
  const calculatedStockValue = (
    <span
      className={
        calculatedStock < 0
          ? "inline-flex w-fit items-center gap-1.5 text-destructive outline-none"
          : undefined
      }
      tabIndex={calculatedStock < 0 ? 0 : undefined}
    >
      {calculatedStock < 0 && (
        <span
          className="h-2 w-2 shrink-0 rounded-full bg-destructive"
          aria-label="Below safety stock"
        />
      )}
      {calculatedStock} {item.unitName}
    </span>
  );

  if (isMaster) {
    const axes = item.variantAxes ?? [];
    return (
      <div className="space-y-6 p-6">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <Link
              href={basePath}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <HugeiconsIcon icon={ArrowLeft01Icon} size={14} aria-hidden /> Back to {typeLabel}
            </Link>
            <h1 className="text-2xl font-semibold tracking-tight">{item.name}</h1>
            <Badge variant="outline">Variant Family</Badge>
          </div>
          <div className="flex items-center gap-2">
            {canEdit && (
              <Button size="sm" asChild>
                <Link href={`/inventory/products/${item.id}/variants/new`}>Add Variant</Link>
              </Button>
            )}
          </div>
        </div>
        <Separator />

        {item.description && (
          <p className="max-w-2xl text-sm text-muted-foreground">{item.description}</p>
        )}

        <dl className="grid max-w-2xl grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2">
          <div>
            <dt className="text-sm font-medium text-muted-foreground">
              <TooltipHeader label="Category" tooltip={ITEM_CATEGORY_TOOLTIP} />
            </dt>
            <dd className="mt-1 text-sm">{item.category ?? "\u2014"}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">
              <TooltipHeader label="Variant Axes" tooltip={VARIANT_AXES_TOOLTIP} />
            </dt>
            <dd className="mt-1 flex flex-wrap gap-1.5">
              {axes.length > 0
                ? axes.map((axis) => (
                    <Badge key={axis} variant="secondary">
                      {axis}
                    </Badge>
                  ))
                : "\u2014"}
            </dd>
          </div>
        </dl>

        <Separator />
        <div className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight">
            Variants
            {variants && variants.length > 0 && (
              <span className="ml-2 text-base font-normal text-muted-foreground">
                ({variants.length})
              </span>
            )}
          </h2>
          {variants && variants.length > 0 ? (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Variant</TableHead>
                    <TableHead>
                      <TooltipHeader label="SKU" tooltip={ITEM_SKU_TOOLTIP} />
                    </TableHead>
                    <TableHead className="text-right">
                      <TooltipHeader label="Stock" tooltip={ON_HAND_STOCK_TOOLTIP} />
                    </TableHead>
                    <TableHead className="text-right">
                      <TooltipHeader label="Calculated Stock" tooltip={CALCULATED_STOCK_TOOLTIP} />
                    </TableHead>
                    <TableHead className="text-right">
                      <TooltipHeader label="Price" tooltip={SELLING_PRICE_TOOLTIP} />
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {variants.map((v) => {
                    const attrLabel = axes.length > 0 && v.variantAttrs
                      ? axes.map((a) => v.variantAttrs![a]).filter(Boolean).join(" / ")
                      : v.name;
                    const calcStockVal = calcStock(v);
                    const isLow = calcStockVal < 0;
                    return (
                      <TableRow key={v.id}>
                        <TableCell>
                          <Link
                            href={`/inventory/products/${v.id}`}
                            className="font-medium hover:underline"
                          >
                            {attrLabel}
                          </Link>
                          {v.unit && (
                            <span className="ml-1.5 text-xs text-muted-foreground">
                              {v.unit}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-sm text-muted-foreground">
                          {v.sku ?? "\u2014"}
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          {formatQuantity(v.stock)}
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          {isLow ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="inline-flex items-center justify-end gap-1.5 text-destructive">
                                  <span className="h-2 w-2 shrink-0 rounded-full bg-destructive" />
                                  {calcStockVal}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent side="top">
                                {CALCULATED_STOCK_ALERT_TOOLTIP}
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            calcStockVal
                          )}
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          {formatPrice(v.defaultSellingPrice) ?? "\u2014"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No variants yet.{" "}
              <Link
                href={`/inventory/products/${item.id}/variants/new`}
                className="font-medium hover:underline"
              >
                Add the first one.
              </Link>
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <Link
            href={basePath}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <HugeiconsIcon icon={ArrowLeft01Icon} size={14} aria-hidden /> Back to {typeLabel}
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">{headingTitle}</h1>
          {isVariant && item.parentName && (
            <p className="text-sm text-muted-foreground">
              Variant of{" "}
              <Link
                href={`/inventory/products/${item.parentId}`}
                className="font-medium hover:underline"
              >
                {item.parentName}
              </Link>
            </p>
          )}
          {itemType === "product" && item.sellable === false ? (
            <Badge variant="outline" className="mt-2">
              Not sellable
            </Badge>
          ) : null}
          {itemType === "product" && item.bomLocked ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className="mt-2 inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground"
                  aria-label="Locked recipe"
                >
                  <HugeiconsIcon icon={CircleLock01Icon} size={14} strokeWidth={2} />
                  Locked recipe
                </span>
              </TooltipTrigger>
              <TooltipContent side="top">
                Only inventory admins can edit locked recipes.
              </TooltipContent>
            </Tooltip>
          ) : null}
        </div>
        <ItemDetailActions
          itemId={item.id}
          itemType={itemType}
          canEdit={canEdit}
          canDelete={canEdit}
          canViewLedger={canViewLedger}
        />
      </div>
      <Separator />

      {item.description && (
        <p className="max-w-2xl text-sm text-muted-foreground">{item.description}</p>
      )}

      {/* Metadata grid */}
      <dl className="grid max-w-2xl grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2">
        <div>
          <dt className="text-sm font-medium text-muted-foreground">
            <TooltipHeader label="SKU" tooltip={ITEM_SKU_TOOLTIP} />
          </dt>
          <dd className="mt-1 text-sm">{item.sku ?? "\u2014"}</dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-muted-foreground">
            <TooltipHeader label="Category" tooltip={ITEM_CATEGORY_TOOLTIP} />
          </dt>
          <dd className="mt-1 text-sm">{item.category ?? "\u2014"}</dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-muted-foreground">
            <TooltipHeader label="Stocking Unit" tooltip={STOCKING_UNIT_TOOLTIP} />
          </dt>
          <dd className="mt-1 text-sm">
            {item.unitName} ({item.unitSize} {item.unitUom})
          </dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-muted-foreground">
            <TooltipHeader label="Purchase Unit" tooltip={PURCHASE_UNIT_TOOLTIP} />
          </dt>
          <dd className="mt-1 text-sm">
            {item.purchaseUnitName && item.purchaseUnitSize && item.purchaseUnitUom
              ? `${item.purchaseUnitName} (${item.purchaseUnitSize} ${item.purchaseUnitUom})`
              : "\u2014"}
          </dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-muted-foreground">
            <TooltipHeader label="Purchase Conversion" tooltip={PURCHASE_CONVERSION_TOOLTIP} />
          </dt>
          <dd className="mt-1 text-sm">
            {item.purchaseUnitName && item.purchaseToStockFactor
              ? `1 ${item.purchaseUnitName} = ${item.purchaseToStockFactor} ${item.unitName}`
              : "\u2014"}
          </dd>
        </div>
        {!isMaster && itemType === "material" && (
          <div>
            <dt className="text-sm font-medium text-muted-foreground">
              <TooltipHeader label="Purchase Price" tooltip={PURCHASE_PRICE_TOOLTIP} />
            </dt>
            <dd className="mt-1 text-sm">
              <span>{formatPrice(item.defaultPurchasePrice) ?? "\u2014"}</span>
              <span className="block text-xs text-muted-foreground">
                {item.purchaseUnitName
                  ? `Per ${item.purchaseUnitName}`
                  : `Per ${item.unitName ?? "stock"} unit`}
              </span>
            </dd>
          </div>
        )}
        {!isMaster && itemType === "material" && (
          <div>
            <dt className="text-sm font-medium text-muted-foreground">
              <TooltipHeader
                label="Current Stock Unit Cost"
                tooltip={CURRENT_STOCK_UNIT_COST_TOOLTIP}
              />
            </dt>
            <dd className="mt-1 text-sm">
              <span>{formatCost(item.currentStockUnitCost) ?? "\u2014"}</span>
              <span className="block text-xs text-muted-foreground">
                Per {item.unitName ?? "stock"} unit. Updated automatically from opening stock and
                purchase receipts.
              </span>
            </dd>
          </div>
        )}
        {!isMaster && (
        <div>
          <dt className="text-sm font-medium text-muted-foreground">
            <TooltipHeader label="Selling Price" tooltip={SELLING_PRICE_TOOLTIP} />
          </dt>
          <dd className="mt-1 text-sm">{formatPrice(item.defaultSellingPrice) ?? "\u2014"}</dd>
        </div>
        )}
        {itemType === "product" && (
          <div>
            <dt className="text-sm font-medium text-muted-foreground">
              <TooltipHeader
                label="Manufacturing Mode"
                tooltip="Production execution style for this product."
              />
            </dt>
            <dd className="mt-1 text-sm capitalize">{item.manufacturingMode ?? "discrete"}</dd>
          </div>
        )}
        {itemType === "product" && item.manufacturingMode === "batch" && item.expectedBatchYield != null && (
          <div>
            <dt className="text-sm font-medium text-muted-foreground">
              <TooltipHeader label="Expected Batch Yield" tooltip={BATCH_YIELD_TOOLTIP} />
            </dt>
            <dd className="mt-1 text-sm">{item.expectedBatchYield} {item.unitName}</dd>
          </div>
        )}
        {!isMaster && (
        <>
        <div>
          <dt className="text-sm font-medium text-muted-foreground">
            <TooltipHeader label="Physical Stock" tooltip={ON_HAND_STOCK_TOOLTIP} />
          </dt>
          <dd className="mt-1 text-sm">{formatQuantity(item.stock)} {item.unitName}</dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-muted-foreground">
            <TooltipHeader label="Available" tooltip={AVAILABLE_QTY_TOOLTIP} />
          </dt>
          <dd className="mt-1 text-sm">{formatQuantity(item.availableQty)} {item.unitName}</dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-muted-foreground">
            <TooltipHeader label="Reserved" tooltip={RESERVED_QTY_TOOLTIP} />
          </dt>
          <dd className="mt-1 text-sm">{formatQuantity(item.committedQty)} {item.unitName}</dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-muted-foreground">
            <TooltipHeader label="Demand" tooltip={DEMAND_QTY_TOOLTIP} />
          </dt>
          <dd className="mt-1 text-sm">{formatQuantity(item.demandQty)} {item.unitName}</dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-muted-foreground">
            <TooltipHeader label="Backorder" tooltip={BACKORDER_QTY_TOOLTIP} />
          </dt>
          <dd className="mt-1 text-sm">{formatQuantity(item.shortageQty)} {item.unitName}</dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-muted-foreground">
            <TooltipHeader label="Expected" tooltip={EXPECTED_QTY_TOOLTIP} />
          </dt>
          <dd className="mt-1 text-sm">{formatQuantity(item.expectedQty)} {item.unitName}</dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-muted-foreground">
            <TooltipHeader label="Safety Stock" tooltip={SAFETY_STOCK_TOOLTIP} />
          </dt>
          <dd className="mt-1 text-sm">{item.safetyStock} {item.unitName}</dd>
        </div>
        </>
        )}
        {!isMaster && (
        <div>
          <dt className="text-sm font-medium text-muted-foreground">
            <TooltipHeader label="Calculated Stock" tooltip={CALCULATED_STOCK_TOOLTIP} />
          </dt>
          <dd className="mt-1 text-sm">
            {calculatedStock < 0 ? (
              <Tooltip>
                <TooltipTrigger asChild>{calculatedStockValue}</TooltipTrigger>
                <TooltipContent side="top">
                  {CALCULATED_STOCK_ALERT_TOOLTIP}
                </TooltipContent>
              </Tooltip>
            ) : (
              calculatedStockValue
            )}
          </dd>
        </div>
        )}
      </dl>

      {/* BOM Section — renders only when bom prop is provided and non-empty */}
      {itemType === "product" && item.bomLocked && !canViewBom ? (
        <>
          <Separator />
          <div className="space-y-3">
            <h2 className="text-lg font-semibold tracking-tight">Recipe / Bill of Materials</h2>
            <p className="text-sm text-muted-foreground">
              This recipe is locked. Inventory or manufacturing admin access is required to
              view its ingredients.
            </p>
          </div>
        </>
      ) : null}

      {itemType === "product" && canViewBom ? (
        <>
          <Separator />
          <div className="space-y-3">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="space-y-1">
                <h2 className="text-lg font-semibold tracking-tight">Recipe / Bill of Materials</h2>
                {item.currentBomRevision ? (
                  <p className="text-sm text-muted-foreground">
                    Rev {item.currentBomRevision.revisionNumber}
                    {" • "}
                    {item.currentBomRevision.createdAt.toLocaleDateString("en-US")}
                    {item.currentBomRevision.createdByName
                      ? ` • ${item.currentBomRevision.createdByName}`
                      : ""}
                  </p>
                ) : null}
                {item.currentBomRevision?.note ? (
                  <p className="text-sm text-muted-foreground">
                    {item.currentBomRevision.note}
                  </p>
                ) : null}
              </div>
              {item.currentBomRevision ? (
                <Button type="button" variant="outline" size="sm" asChild>
                  <Link href={`${basePath}/${item.id}/bom-history`}>View History</Link>
                </Button>
              ) : null}
            </div>
            {bom && bom.length > 0 ? (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Component</TableHead>
                      <TableHead>
                        <TooltipHeader label="Type" tooltip={ITEM_TYPE_TOOLTIP} />
                      </TableHead>
                      <TableHead className="text-right">
                        <TooltipHeader
                          label={item.manufacturingMode === "batch" ? "Qty / Batch" : "Qty"}
                          tooltip={
                            item.manufacturingMode === "batch"
                              ? BOM_QTY_PER_BATCH_TOOLTIP
                              : BOM_QTY_PER_UNIT_TOOLTIP
                          }
                        />
                      </TableHead>
                      {item.manufacturingMode === "batch" && item.expectedBatchYield != null && (
                        <TableHead className="text-right">
                          <TooltipHeader label="Qty / Unit" tooltip={BOM_QTY_PER_UNIT_TOOLTIP} />
                        </TableHead>
                      )}
                      <TableHead>Requirements</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {bom.map((b) => {
                      const batchQty = b.quantity ? parseFloat(b.quantity) : null;
                      const yieldVal = item.expectedBatchYield ? parseFloat(item.expectedBatchYield) : null;
                      const perUnit = batchQty != null && yieldVal != null && yieldVal > 0
                        ? parseFloat((batchQty / yieldVal).toFixed(4).replace(/\.?0+$/, ""))
                        : null;

                      return (
                        <TableRow key={b.id}>
                          <TableCell>
                            <Link
                              href={itemDetailHref(b.componentItemType, b.componentId)}
                              className="hover:underline"
                            >
                              {b.componentName}
                            </Link>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{b.componentItemType}</Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            {batchQty != null ? `${batchQty} ${b.componentUnit}` : "\u2014"}
                          </TableCell>
                          {item.manufacturingMode === "batch" && item.expectedBatchYield != null && (
                            <TableCell className="text-right text-muted-foreground">
                              {perUnit != null ? `${perUnit} ${b.componentUnit}` : "\u2014"}
                            </TableCell>
                          )}
                          <TableCell className="text-sm text-muted-foreground">
                            {b.minimumLotAgeDays
                              ? `Lot must be at least ${b.minimumLotAgeDays} ${
                                  b.minimumLotAgeDays === 1 ? "day" : "days"
                                } old.`
                              : "\u2014"}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No active BOM ingredients on the current revision.
              </p>
            )}
          </div>
        </>
      ) : null}

      <Separator />
      <div className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Used In</h2>
        {usedInParents && usedInParents.length > 0 ? (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {usedInParents.map((parent) => (
                  <TableRow key={parent.id}>
                    <TableCell>
                      <Link
                        href={`/inventory/products/${parent.id}`}
                        className="font-medium hover:underline"
                      >
                        {parent.displayName}
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Not used in any current product recipes.
          </p>
        )}
      </div>

      {/* Lots */}
      <Separator />
      <div className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Lots</h2>
        {lots.length === 0 ? (
          <p className="text-sm text-muted-foreground">No lots recorded.</p>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <TooltipHeader label="Lot Number" tooltip={LOT_NUMBER_TOOLTIP} />
                  </TableHead>
                  <TableHead className="text-right">
                    <TooltipHeader label="Physical" tooltip={LOT_PHYSICAL_TOOLTIP} />
                  </TableHead>
                  <TableHead>
                    <TooltipHeader label="Disposition" tooltip={LOT_DISPOSITION_TOOLTIP} />
                  </TableHead>
                  <TableHead className="text-right">
                    <TooltipHeader label="Cost / Unit" tooltip={LOT_UNIT_COST_TOOLTIP} />
                  </TableHead>
                  <TableHead className="text-right">Sold</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">COGS</TableHead>
                  <TableHead className="text-right">Profit</TableHead>
                  <TableHead className="text-right">
                    <TooltipHeader label="Actual Margin" tooltip={ACTUAL_MARGIN_TOOLTIP} />
                  </TableHead>
                  <TableHead className="text-right">Received</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lots.map((lot) => (
                  <TableRow key={lot.id}>
                    <TableCell className="font-mono">{lot.lotNumber}</TableCell>
                    <TableCell className="text-right">{formatQuantity(lot.quantity)}</TableCell>
                    <TableCell>
                      {lot.dispositionBalances.length > 0 ? (
                        <div className="flex flex-col gap-1">
                          {lot.dispositionBalances.map((balance) => (
                            <div
                              key={`${lot.id}-${balance.disposition}`}
                              className="flex items-center justify-between gap-3"
                            >
                              <span>{formatInventoryDisposition(balance.disposition)}</span>
                              <span className="font-mono text-muted-foreground">
                                {formatQuantity(balance.quantity)}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        "\u2014"
                      )}
                    </TableCell>
                    <TableCell className="text-right">{formatCost(lot.costPerUnit) ?? "\u2014"}</TableCell>
                    <TableCell className="text-right">{formatQuantity(lot.soldQuantity)}</TableCell>
                    <TableCell className="text-right">
                      {formatPrice(lot.realizedRevenue) ?? "\u2014"}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatPrice(lot.realizedCogs) ?? "\u2014"}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatPrice(lot.realizedGrossProfit) ?? "\u2014"}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatMarginPercent(lot.realizedMarginPercent)}
                    </TableCell>
                    <TableCell className="text-right">{lot.receivedAt.toLocaleDateString("en-US")}</TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-2">
                        {lot.dispositionBalances.map((balance) => (
                          <LotDispositionActions
                            key={`${lot.id}-${balance.disposition}-actions`}
                            itemId={item.id}
                            lotId={lot.id}
                            fromDisposition={balance.disposition}
                            maxQuantity={balance.quantity}
                          />
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Stock Movements */}
      <Separator />
      <div className="space-y-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <h2 className="text-lg font-semibold tracking-tight">Stock Movements</h2>
          {canViewLedger ? (
            <Button variant="outline" size="sm" asChild>
              <Link href={`/inventory/ledger?itemId=${item.id}`}>View Full Ledger</Link>
            </Button>
          ) : null}
        </div>
        {movements.length === 0 ? (
          <p className="text-sm text-muted-foreground">No stock movements recorded.</p>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">
                    <TooltipHeader label="Quantity" tooltip={LEDGER_CHANGE_TOOLTIP} />
                  </TableHead>
                  <TableHead>
                    <TooltipHeader label="Lot" tooltip={LEDGER_LOT_TOOLTIP} />
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {movements.map((m) => {
                  const qty = parseFloat(m.quantity);
                  return (
                    <TableRow key={m.id}>
                      <TableCell>{m.createdAt.toLocaleDateString("en-US")}</TableCell>
                      <TableCell className="text-muted-foreground">{formatMovementType(m.movementType)}</TableCell>
                      <TableCell className={`text-right font-mono ${qty > 0 ? "text-foreground" : "text-destructive"}`}>
                        {qty > 0 ? "+" : ""}
                        {formatQuantity(m.quantity)}
                      </TableCell>
                      <TableCell className="font-mono">{m.lotNumber ?? "\u2014"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

    </div>
  );
}
