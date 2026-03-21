import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import { calcStock, ITEM_TYPE_SEGMENTS, type ItemType } from "@/app/(dashboard)/inventory/types";
import { formatPrice } from "@/lib/format";

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
    lotNumber: string | null;
    createdAt: Date;
  }[];
}

export function ItemDetail({ item, itemType, bom, lots, movements }: ItemDetailProps) {
  const calculatedStock = calcStock(item);
  const basePath = `/inventory/${ITEM_TYPE_SEGMENTS[itemType]}`;
  const typeLabel = itemType === "product" ? "Products" : "Materials";

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
          <dt className="text-sm font-medium text-muted-foreground">Unit</dt>
          <dd className="mt-1 text-sm">
            {item.unitName} ({parseFloat(item.unitSize)} {item.unitUom})
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
          <dt className="text-sm font-medium text-muted-foreground">Calculated Stock</dt>
          <dd className="mt-1 text-sm">
            <span className={calculatedStock < 0 ? "inline-flex items-center gap-1.5 text-destructive" : undefined}>
              {calculatedStock < 0 && (
                <span className="h-2 w-2 shrink-0 rounded-full bg-destructive" aria-label="Below safety stock" />
              )}
              {calculatedStock} {item.unitName}
            </span>
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
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-4 py-2 text-left font-medium text-muted-foreground">Component</th>
                    <th className="px-4 py-2 text-left font-medium text-muted-foreground">Type</th>
                    <th className="px-4 py-2 text-right font-medium text-muted-foreground">Qty</th>
                    <th className="px-4 py-2 text-right font-medium text-muted-foreground">Unit</th>
                  </tr>
                </thead>
                <tbody>
                  {bom.map((b) => (
                    <tr key={b.id} className="border-b last:border-0">
                      <td className="px-4 py-2">{b.componentName}</td>
                      <td className="px-4 py-2">
                        <Badge variant="outline">{b.componentItemType}</Badge>
                      </td>
                      <td className="px-4 py-2 text-right font-mono">
                        {b.quantity ? parseFloat(b.quantity) : "\u2014"}
                      </td>
                      <td className="px-4 py-2 text-right">{b.componentUnit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground">Lot Number</th>
                  <th className="px-4 py-2 text-right font-medium text-muted-foreground">Quantity</th>
                  <th className="px-4 py-2 text-right font-medium text-muted-foreground">Cost / Unit</th>
                  <th className="px-4 py-2 text-right font-medium text-muted-foreground">Received</th>
                </tr>
              </thead>
              <tbody>
                {lots.map((lot) => (
                  <tr key={lot.id} className="border-b last:border-0">
                    <td className="px-4 py-2 font-mono">{lot.lotNumber}</td>
                    <td className="px-4 py-2 text-right">{parseFloat(lot.quantity)}</td>
                    <td className="px-4 py-2 text-right">{formatPrice(lot.costPerUnit) ?? "\u2014"}</td>
                    <td className="px-4 py-2 text-right">{lot.receivedAt.toLocaleDateString("en-US")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground">Date</th>
                  <th className="px-4 py-2 text-right font-medium text-muted-foreground">Quantity</th>
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground">Lot</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((m) => {
                  const qty = parseFloat(m.quantity);
                  return (
                    <tr key={m.id} className="border-b last:border-0">
                      <td className="px-4 py-2">{m.createdAt.toLocaleDateString("en-US")}</td>
                      <td className={`px-4 py-2 text-right font-mono ${qty > 0 ? "text-foreground" : "text-destructive"}`}>
                        {qty > 0 ? "+" : ""}{qty}
                      </td>
                      <td className="px-4 py-2 font-mono">{m.lotNumber ?? "\u2014"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
