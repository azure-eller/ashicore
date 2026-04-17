"use client";

import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
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
import { formatPrice, formatQuantity } from "@/lib/format";
import type { SalesOrderDetail } from "./types";

const BADGE_VARIANTS = ["secondary", "outline", "default"] as const;

function StockCell({ value, threshold }: { value: string | null; threshold: number }) {
  if (value === null) return <span className="text-muted-foreground">\u2014</span>;
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
            <TableHead className="text-xs text-right">Qty</TableHead>
            <TableHead className="text-xs">Item</TableHead>
            <TableHead className="text-xs">SKU</TableHead>
            <TableHead className="text-xs text-right">In Stock</TableHead>
            <TableHead className="text-xs text-right">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="cursor-help underline decoration-dotted decoration-muted-foreground/60 underline-offset-4">
                    Potential
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top">
                  How many units could be manufactured from current ingredient stock.
                </TooltipContent>
              </Tooltip>
            </TableHead>
            <TableHead className="text-xs text-right">Unit Price</TableHead>
            <TableHead className="text-xs text-right">Line Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <TableRow key={i}>
                {Array.from({ length: 7 }).map((_, j) => (
                  <TableCell key={j}>
                    <Skeleton className="h-4 w-20" />
                  </TableCell>
                ))}
              </TableRow>
            ))
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
                      <span>{line.masterName}</span>
                      {line.attrs.map((attr, i) => (
                        <Badge
                          key={attr}
                          variant={BADGE_VARIANTS[i % BADGE_VARIANTS.length]}
                          className="text-xs font-normal"
                        >
                          {attr}
                        </Badge>
                      ))}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {line.itemSku ?? "\u2014"}
                  </TableCell>
                  <TableCell className="text-sm text-right">
                    <StockCell value={line.calcStock} threshold={lineQty} />
                  </TableCell>
                  <TableCell className="text-sm text-right">
                    <StockCell value={line.potential} threshold={lineQty} />
                  </TableCell>
                  <TableCell className="text-sm text-right">
                    {formatPrice(line.unitPrice) ?? "\u2014"}
                  </TableCell>
                  <TableCell className="text-sm text-right">
                    {formatPrice(line.lineTotal) ?? "\u2014"}
                  </TableCell>
                </TableRow>
              );
            })
          ) : (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                No line items.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
