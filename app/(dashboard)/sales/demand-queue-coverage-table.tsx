import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { SurfacePanel } from "@/components/surface-panel";
import {
  FramedTable,
  FramedTableBody,
  FramedTableCell,
  FramedTableHeaderCell,
  FramedTableHead,
  FramedTableRow,
  TableFrameHeader,
} from "@/components/table-frame";
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
        <FramedTable>
          <FramedTableHead>
            <FramedTableRow>
              <FramedTableHeaderCell>Item</FramedTableHeaderCell>
              <FramedTableHeaderCell className="text-right">On hand</FramedTableHeaderCell>
              <FramedTableHeaderCell className="text-right">Expected</FramedTableHeaderCell>
              <FramedTableHeaderCell className="text-right">Claimed by mfg</FramedTableHeaderCell>
              <FramedTableHeaderCell className="text-right">Available to sales</FramedTableHeaderCell>
              <FramedTableHeaderCell className="text-right">Short</FramedTableHeaderCell>
            </FramedTableRow>
          </FramedTableHead>
          <FramedTableBody>
            {coverage.map((item) => (
              <FramedTableRow key={item.itemId}>
                <FramedTableCell className="font-medium">{item.itemName}</FramedTableCell>
                <FramedTableCell className="text-right tabular-nums">
                  {formatQuantity(item.onHandQty)}
                </FramedTableCell>
                <FramedTableCell className="text-right tabular-nums">
                  {formatQuantity(item.expectedQty)}
                </FramedTableCell>
                <FramedTableCell className="text-right tabular-nums">
                  {formatQuantity(item.claimedByManufacturingQty)}
                </FramedTableCell>
                <FramedTableCell className="text-right tabular-nums">
                  {formatQuantity(item.sellableQty)}
                </FramedTableCell>
                <FramedTableCell
                  className="text-right tabular-nums"
                  data-short={isShort(item.shortQty) ? "true" : undefined}
                >
                  <span className={isShort(item.shortQty) ? "text-destructive" : undefined}>
                    {formatQuantity(item.shortQty)}
                  </span>
                </FramedTableCell>
              </FramedTableRow>
            ))}
          </FramedTableBody>
        </FramedTable>
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
            <FramedTable>
              <FramedTableHead>
                <FramedTableRow>
                  <FramedTableHeaderCell>Demand</FramedTableHeaderCell>
                  <FramedTableHeaderCell>Type</FramedTableHeaderCell>
                  <FramedTableHeaderCell className="text-right">Required</FramedTableHeaderCell>
                  <FramedTableHeaderCell className="text-right">In stock</FramedTableHeaderCell>
                  <FramedTableHeaderCell className="text-right">Expected</FramedTableHeaderCell>
                  <FramedTableHeaderCell className="text-right">Short</FramedTableHeaderCell>
                </FramedTableRow>
              </FramedTableHead>
              <FramedTableBody>
                {item.demands.map((demand) => (
                  <FramedTableRow key={`${demand.demandType}:${demand.demandId}`}>
                    <FramedTableCell>
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
                    </FramedTableCell>
                    <FramedTableCell className="text-muted-foreground">
                      {demand.typeLabel}
                    </FramedTableCell>
                    <FramedTableCell className="text-right tabular-nums">
                      {formatQuantity(demand.requiredQty)}
                    </FramedTableCell>
                    <FramedTableCell className="text-right tabular-nums">
                      {formatQuantity(demand.inStockQty)}
                    </FramedTableCell>
                    <FramedTableCell className="text-right tabular-nums">
                      <div>{formatQuantity(demand.expectedQty)}</div>
                      {demand.earliestExpectedDate ? (
                        <div className="text-[length:var(--text-xs)] text-muted-foreground">
                          Expected {formatDate(demand.earliestExpectedDate)}
                        </div>
                      ) : null}
                    </FramedTableCell>
                    <FramedTableCell className="text-right tabular-nums">
                      <span
                        className={isShort(demand.shortQty) ? "text-destructive" : undefined}
                      >
                        {formatQuantity(demand.shortQty)}
                      </span>
                    </FramedTableCell>
                  </FramedTableRow>
                ))}
              </FramedTableBody>
            </FramedTable>
          </SurfacePanel>
        ))}
      </div>
    </div>
  );
}
