import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { ItemDetailActions } from "./item-detail-actions";
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
import { formatPrice, formatMovementType, formatQuantity } from "@/lib/format";
import {
  CALCULATED_STOCK_ALERT_TOOLTIP,
  CALCULATED_STOCK_TOOLTIP,
} from "@/lib/tooltip-copy";

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
    defaultSellingPrice: string | null;
    sellable?: boolean | null;
    stock: string;
    committedQty: string;
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
  }[];
  lots: {
    id: string;
    lotNumber: string;
    quantity: string;
    costPerUnit: string | null;
    receivedAt: Date;
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
    expectedQty: string;
    safetyStock: string;
    defaultSellingPrice: string | null;
    unit: string | null;
    variantAttrs: Record<string, string> | null;
  }[];
  canEdit?: boolean;
  canViewBom?: boolean;
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
            <dt className="text-sm font-medium text-muted-foreground">Category</dt>
            <dd className="mt-1 text-sm">{item.category ?? "\u2014"}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Variant Axes</dt>
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
                    <TableHead>SKU</TableHead>
                    <TableHead className="text-right">Stock</TableHead>
                    <TableHead className="text-right">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-flex w-fit cursor-help underline decoration-dotted decoration-muted-foreground/60 underline-offset-4">
                            Available
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="top">
                          {CALCULATED_STOCK_TOOLTIP}
                        </TooltipContent>
                      </Tooltip>
                    </TableHead>
                    <TableHead className="text-right">Price</TableHead>
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
                This recipe is locked and can only be edited by inventory admins.
              </TooltipContent>
            </Tooltip>
          ) : null}
        </div>
        <ItemDetailActions
          itemId={item.id}
          itemType={itemType}
          canEdit={canEdit}
          canDelete={canEdit}
        />
      </div>
      <Separator />

      {item.description && (
        <p className="max-w-2xl text-sm text-muted-foreground">{item.description}</p>
      )}

      {/* Metadata grid */}
      <dl className="grid max-w-2xl grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2">
        <div>
          <dt className="text-sm font-medium text-muted-foreground">SKU</dt>
          <dd className="mt-1 text-sm">{item.sku ?? "\u2014"}</dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-muted-foreground">Category</dt>
          <dd className="mt-1 text-sm">{item.category ?? "\u2014"}</dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-muted-foreground">Stocking Unit</dt>
          <dd className="mt-1 text-sm">
            {item.unitName} ({item.unitSize} {item.unitUom})
          </dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-muted-foreground">Purchase Unit</dt>
          <dd className="mt-1 text-sm">
            {item.purchaseUnitName && item.purchaseUnitSize && item.purchaseUnitUom
              ? `${item.purchaseUnitName} (${item.purchaseUnitSize} ${item.purchaseUnitUom})`
              : "\u2014"}
          </dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-muted-foreground">Purchase Conversion</dt>
          <dd className="mt-1 text-sm">
            {item.purchaseUnitName && item.purchaseToStockFactor
              ? `1 ${item.purchaseUnitName} = ${item.purchaseToStockFactor} ${item.unitName}`
              : "\u2014"}
          </dd>
        </div>
        {!isMaster && itemType === "material" && (
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Purchase Price</dt>
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
        {!isMaster && (
        <div>
          <dt className="text-sm font-medium text-muted-foreground">Selling Price</dt>
          <dd className="mt-1 text-sm">{formatPrice(item.defaultSellingPrice) ?? "\u2014"}</dd>
        </div>
        )}
        {itemType === "product" && (
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Manufacturing Mode</dt>
            <dd className="mt-1 text-sm capitalize">{item.manufacturingMode ?? "discrete"}</dd>
          </div>
        )}
        {itemType === "product" && item.manufacturingMode === "batch" && item.expectedBatchYield != null && (
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Expected Batch Yield</dt>
            <dd className="mt-1 text-sm">{item.expectedBatchYield} {item.unitName}</dd>
          </div>
        )}
        {!isMaster && (
        <>
        <div>
          <dt className="text-sm font-medium text-muted-foreground">Stock</dt>
          <dd className="mt-1 text-sm">{formatQuantity(item.stock)} {item.unitName}</dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-muted-foreground">Committed</dt>
          <dd className="mt-1 text-sm">{formatQuantity(item.committedQty)} {item.unitName}</dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-muted-foreground">Expected</dt>
          <dd className="mt-1 text-sm">{formatQuantity(item.expectedQty)} {item.unitName}</dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-muted-foreground">Safety Stock</dt>
          <dd className="mt-1 text-sm">{item.safetyStock} {item.unitName}</dd>
        </div>
        </>
        )}
        {!isMaster && (
        <div>
          <dt className="text-sm font-medium text-muted-foreground">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex w-fit cursor-help underline decoration-dotted decoration-muted-foreground/60 underline-offset-4">
                  Calculated Stock
                </span>
              </TooltipTrigger>
              <TooltipContent side="top">
                {CALCULATED_STOCK_TOOLTIP}
              </TooltipContent>
            </Tooltip>
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
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">
                        {item.manufacturingMode === "batch" ? "Qty / Batch" : "Qty"}
                      </TableHead>
                      {item.manufacturingMode === "batch" && item.expectedBatchYield != null && (
                        <TableHead className="text-right">Qty / Unit</TableHead>
                      )}
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
                  <TableHead>Lot Number</TableHead>
                  <TableHead className="text-right">Quantity</TableHead>
                  <TableHead className="text-right">Cost / Unit</TableHead>
                  <TableHead className="text-right">Received</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lots.map((lot) => (
                  <TableRow key={lot.id}>
                    <TableCell className="font-mono">{lot.lotNumber}</TableCell>
                    <TableCell className="text-right">{lot.quantity}</TableCell>
                    <TableCell className="text-right">{formatPrice(lot.costPerUnit) ?? "\u2014"}</TableCell>
                    <TableCell className="text-right">{lot.receivedAt.toLocaleDateString("en-US")}</TableCell>
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
        <h2 className="text-lg font-semibold tracking-tight">Stock Movements</h2>
        {movements.length === 0 ? (
          <p className="text-sm text-muted-foreground">No stock movements recorded.</p>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Quantity</TableHead>
                  <TableHead>Lot</TableHead>
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
