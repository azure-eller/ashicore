"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Spinner } from "@/components/ui/spinner";
import { itemDetailHref } from "@/app/(dashboard)/inventory/types";
import { TooltipHeader } from "@/components/tooltip-header";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatPrice, formatQuantity } from "@/lib/format";
import {
  ITEM_SKU_TOOLTIP,
  ESTIMATED_LINE_COGS_TOOLTIP,
  ESTIMATED_MARGIN_TOOLTIP,
  ON_HAND_STOCK_TOOLTIP,
  POTENTIAL_TOOLTIP,
  SALES_LINE_QTY_TOOLTIP,
  SALES_UNIT_PRICE_TOOLTIP,
  LINE_TOTAL_TOOLTIP,
} from "@/lib/tooltip-copy";
import { OrderLineAttributeBadges } from "./order-line-attribute-badges";
import type { SalesOrderDetail } from "./types";

function StockCell({ value, threshold }: { value: string | null; threshold: number }) {
  if (value === null) return <span className="text-muted-foreground">{"\u2014"}</span>;
  const qty = parseFloat(value);
  const isLow = qty < threshold;
  return (
    <span className={`inline-flex items-center gap-1.5 ${isLow ? "text-destructive" : ""}`}>
      {isLow && <span className="h-2 w-2 shrink-0 rounded-full bg-destructive" />}
      {formatQuantity(value)}
    </span>
  );
}

export function OrderExpandedDetail({ orderId }: { orderId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["sales-order-detail", orderId],
    queryFn: async () => {
      const res = await fetch(`/api/sales-orders/${orderId}`);
      if (!res.ok) throw new Error("Failed to fetch order");
      return res.json() as Promise<SalesOrderDetail>;
    },
  });

  return (
    <div className="bg-muted/50 px-8 py-3">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs text-right">
              <TooltipHeader label="Qty" tooltip={SALES_LINE_QTY_TOOLTIP} />
            </TableHead>
            <TableHead className="text-xs">Item</TableHead>
            <TableHead className="text-xs">
              <TooltipHeader label="SKU" tooltip={ITEM_SKU_TOOLTIP} />
            </TableHead>
            <TableHead className="text-xs text-right">
              <TooltipHeader label="In Stock" tooltip={ON_HAND_STOCK_TOOLTIP} />
            </TableHead>
            <TableHead className="text-xs text-right">
              <TooltipHeader label="Potential" tooltip={POTENTIAL_TOOLTIP} />
            </TableHead>
            <TableHead className="text-xs text-right">
              <TooltipHeader label="Unit Price" tooltip={SALES_UNIT_PRICE_TOOLTIP} />
            </TableHead>
            <TableHead className="text-xs text-right">
              <TooltipHeader label="Est. COGS" tooltip={ESTIMATED_LINE_COGS_TOOLTIP} />
            </TableHead>
            <TableHead className="text-xs text-right">
              <TooltipHeader label="Line Total" tooltip={LINE_TOTAL_TOOLTIP} />
            </TableHead>
            <TableHead className="text-xs text-right">
              <TooltipHeader label="Est. Margin" tooltip={ESTIMATED_MARGIN_TOOLTIP} />
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={9}>
                <div className="flex min-h-24 items-center justify-center">
                  <Spinner className="text-foreground" />
                </div>
              </TableCell>
            </TableRow>
          ) : data?.lines.length ? (
            data.lines.map((line) => {
              const lineQty = parseFloat(line.quantity);
              return (
                <TableRow key={line.id}>
                  <TableCell className="text-sm text-right">
                    {parseFloat(line.quantity)}
                  </TableCell>
                  <TableCell className="text-sm">
                    <span className="flex items-center gap-1.5 flex-wrap">
                      <Link
                        href={itemDetailHref("product", line.itemId)}
                        className="hover:underline"
                      >
                        {line.masterName}
                      </Link>
                      <OrderLineAttributeBadges attrs={line.attrs} />
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {line.itemSku ?? "\u2014"}
                  </TableCell>
                  <TableCell className="text-sm text-right">
                    <StockCell value={line.onHandQty} threshold={lineQty} />
                  </TableCell>
                  <TableCell className="text-sm text-right">
                    <StockCell value={line.potential} threshold={lineQty} />
                  </TableCell>
                  <TableCell className="text-sm text-right">
                    {formatPrice(line.unitPrice) ?? "\u2014"}
                  </TableCell>
                  <TableCell className="text-sm text-right">
                    {formatPrice(line.estimatedCogs) ?? "\u2014"}
                  </TableCell>
                  <TableCell className="text-sm text-right">
                    {formatPrice(line.lineTotal) ?? "\u2014"}
                  </TableCell>
                  <TableCell className="text-sm text-right">
                    {line.estimatedMarginPercent != null
                      ? `${line.estimatedMarginPercent}%`
                      : "\u2014"}
                  </TableCell>
                </TableRow>
              );
            })
          ) : (
            <TableRow>
              <TableCell colSpan={9} className="text-center text-sm text-muted-foreground">
                No line items.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
