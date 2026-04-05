import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
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
import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import { calcStock, ITEM_TYPE_SEGMENTS, type ItemType } from "@/app/(dashboard)/inventory/types";
import { formatPrice, formatMovementType } from "@/lib/format";
import {
  CALCULATED_STOCK_ALERT_TOOLTIP,
  CALCULATED_STOCK_TOOLTIP,
} from "@/lib/tooltip-copy";

interface ItemDetailProps {
  item: {
    id: string;
    name: string;
    sku: string | null;
    category: string | null;
    description: string | null;
    unitName: string;
    unitSize: string;
    unitUom: string;
    purchaseUnitName: string | null;
    purchaseUnitSize: string | null;
    purchaseUnitUom: string | null;
    purchaseToStockFactor: string | null;
    defaultPurchasePrice: string | null;
    defaultSellingPrice: string | null;
    stock: string;
    committedQty: string;
    expectedQty: string;
    safetyStock: string;
  };
  itemType: ItemType;
  bom?: {
    id: string;
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
}

export function ItemDetail({ item, itemType, bom, lots, movements }: ItemDetailProps) {
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
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href={`${basePath}/${item.id}/edit`}>Edit</Link>
        </Button>
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
            {item.unitName} ({parseFloat(item.unitSize)} {item.unitUom})
          </dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-muted-foreground">Purchase Unit</dt>
          <dd className="mt-1 text-sm">
            {item.purchaseUnitName && item.purchaseUnitSize && item.purchaseUnitUom
              ? `${item.purchaseUnitName} (${parseFloat(item.purchaseUnitSize)} ${item.purchaseUnitUom})`
              : "\u2014"}
          </dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-muted-foreground">Purchase Conversion</dt>
          <dd className="mt-1 text-sm">
            {item.purchaseUnitName && item.purchaseToStockFactor
              ? `1 ${item.purchaseUnitName} = ${parseFloat(item.purchaseToStockFactor)} ${item.unitName}`
              : "\u2014"}
          </dd>
        </div>
        {itemType === "material" && (
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Purchase Price</dt>
            <dd className="mt-1 text-sm">{formatPrice(item.defaultPurchasePrice) ?? "\u2014"}</dd>
          </div>
        )}
        <div>
          <dt className="text-sm font-medium text-muted-foreground">Selling Price</dt>
          <dd className="mt-1 text-sm">{formatPrice(item.defaultSellingPrice) ?? "\u2014"}</dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-muted-foreground">Stock</dt>
          <dd className="mt-1 text-sm">{parseFloat(item.stock)} {item.unitName}</dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-muted-foreground">Committed</dt>
          <dd className="mt-1 text-sm">{parseFloat(item.committedQty)} {item.unitName}</dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-muted-foreground">Expected</dt>
          <dd className="mt-1 text-sm">{parseFloat(item.expectedQty)} {item.unitName}</dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-muted-foreground">Safety Stock</dt>
          <dd className="mt-1 text-sm">{parseFloat(item.safetyStock)} {item.unitName}</dd>
        </div>
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
      </dl>

      {/* BOM Section — renders only when bom prop is provided and non-empty */}
      {bom && bom.length > 0 && (
        <>
          <Separator />
          <div className="space-y-3">
            <h2 className="text-lg font-semibold tracking-tight">Recipe / Bill of Materials</h2>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Component</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Stocking Unit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bom.map((b) => (
                    <TableRow key={b.id}>
                      <TableCell>{b.componentName}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{b.componentItemType}</Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {b.quantity ? parseFloat(b.quantity) : "\u2014"}
                      </TableCell>
                      <TableCell className="text-right">{b.componentUnit}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </>
      )}

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
                    <TableCell className="text-right">{parseFloat(lot.quantity)}</TableCell>
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
                        {qty > 0 ? "+" : ""}{qty}
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
