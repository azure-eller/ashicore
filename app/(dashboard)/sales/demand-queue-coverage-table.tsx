import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { SurfacePanel } from "@/components/surface-panel";
import { TableFrameHeader } from "@/components/table-frame";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate, formatQuantity } from "@/lib/format";
import type { DemandQueueItemCoverage } from "@/lib/inventory/allocation/demand-queue";

function isShort(value: string) {
  return Number(value) > 0;
}

export function DemandQueueCoverageTable({
  coverage,
}: {
  coverage: DemandQueueItemCoverage[];
}) {
  if (coverage.length === 0) {
    return <EmptyState className="bg-card">No open demand to plan.</EmptyState>;
  }

  return (
    <div className="flex flex-col gap-(--space-10) p-(--space-8)">
      <div className="flex flex-col gap-(--space-2)">
        <h1 className="text-[length:var(--text-lg)] font-semibold text-foreground">
          Allocation · Demand queue
        </h1>
        <p className="text-[length:var(--text-sm)] text-muted-foreground">
          Manufacturing demand claims component stock before sales demand. Exact
          lots are chosen at picking, consumption, and shipping.
        </p>
      </div>

      <SurfacePanel padding="sm" className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead className="text-right">On hand</TableHead>
              <TableHead className="text-right">Expected</TableHead>
              <TableHead className="text-right">Claimed by mfg</TableHead>
              <TableHead className="text-right">Available to sales</TableHead>
              <TableHead className="text-right">Short</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {coverage.map((item) => (
              <TableRow key={item.itemId}>
                <TableCell className="font-medium">{item.itemName}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatQuantity(item.onHandQty)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatQuantity(item.expectedQty)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatQuantity(item.claimedByManufacturingQty)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatQuantity(item.sellableQty)}
                </TableCell>
                <TableCell
                  className="text-right tabular-nums"
                  data-short={isShort(item.shortQty) ? "true" : undefined}
                >
                  <span className={isShort(item.shortQty) ? "text-destructive" : undefined}>
                    {formatQuantity(item.shortQty)}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </SurfacePanel>

      <div className="flex flex-col gap-(--space-8)">
        {coverage.map((item) => (
          <SurfacePanel key={item.itemId} padding="sm" className="p-0">
            <TableFrameHeader className="text-[length:var(--text-sm)] font-medium">
              {item.itemName}
              <span className="ml-(--space-2) text-muted-foreground">
                · {formatQuantity(item.onHandQty)} {item.unitName} on hand
              </span>
            </TableFrameHeader>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Demand</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Required</TableHead>
                  <TableHead className="text-right">In stock</TableHead>
                  <TableHead className="text-right">Expected</TableHead>
                  <TableHead className="text-right">Short</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {item.demands.map((demand) => (
                  <TableRow key={`${demand.demandType}:${demand.demandId}`}>
                    <TableCell>
                      {demand.href ? (
                        <Link href={demand.href} className="font-medium hover:underline">
                          {demand.label}
                        </Link>
                      ) : (
                        <span className="font-medium">{demand.label}</span>
                      )}
                      {demand.contextLabel ? (
                        <span className="ml-(--space-2) text-muted-foreground">
                          {demand.contextLabel}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {demand.typeLabel}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatQuantity(demand.requiredQty)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatQuantity(demand.inStockQty)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <div>{formatQuantity(demand.expectedQty)}</div>
                      {demand.earliestExpectedDate ? (
                        <div className="text-[length:var(--text-xs)] text-muted-foreground">
                          Expected {formatDate(demand.earliestExpectedDate)}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <span
                        className={isShort(demand.shortQty) ? "text-destructive" : undefined}
                      >
                        {formatQuantity(demand.shortQty)}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </SurfacePanel>
        ))}
      </div>
    </div>
  );
}
