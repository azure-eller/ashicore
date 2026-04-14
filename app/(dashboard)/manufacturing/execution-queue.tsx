import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatDate, formatQuantity } from "@/lib/format";
import { ManufacturingPickProgressBadge } from "./pick-progress-badge";
import type { ManufacturingExecutionQueueRow } from "./types";

export function ManufacturingExecutionQueue({
  rows,
}: {
  rows: ManufacturingExecutionQueueRow[];
}) {
  if (rows.length === 0) {
    return (
      <div className="mx-auto w-full max-w-5xl py-8">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">Manufacturing Execution</h1>
          <p className="text-sm text-muted-foreground">
            No released manufacturing work is waiting in the queue.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl py-8">
      <div className="space-y-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">Manufacturing Execution</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Start or continue the next order in production. This surface is the simple
            fallback for the mobile manufacturing workflow.
          </p>
        </div>

        <div className="grid gap-4">
          {rows.map((row) => (
            <Card key={row.id} className="border border-border/80">
              <CardHeader className="gap-3">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle>{row.orderNumber}</CardTitle>
                    <ManufacturingPickProgressBadge status={row.pickProgressStatus} />
                    {row.manufacturingMode === "batch" && (
                      <Badge variant="outline">
                        {row.completedBatchCount}/{row.totalBatchCount} batches complete
                      </Badge>
                    )}
                  </div>
                  <CardDescription>
                    {row.productSku
                      ? `${row.productName} (${row.productSku})`
                      : row.productName}
                  </CardDescription>
                </div>
                <CardAction>
                  <Button asChild>
                    <Link href={`/manufacturing/orders/${row.id}/execute`}>
                      {row.actionLabel}
                    </Link>
                  </Button>
                </CardAction>
              </CardHeader>
              <CardContent>
                <dl className="grid gap-4 text-sm sm:grid-cols-3">
                  <div>
                    <dt className="text-muted-foreground">Planned</dt>
                    <dd className="mt-1 font-medium">
                      {formatQuantity(row.plannedQuantity)} {row.unitName}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Actual</dt>
                    <dd className="mt-1 font-medium">
                      {formatQuantity(row.actualQuantity)} {row.unitName}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Planned Date</dt>
                    <dd className="mt-1 font-medium">{formatDate(row.plannedDate)}</dd>
                  </div>
                </dl>
                {row.manufacturingMode === "batch" && row.nextBatchNumber != null && (
                  <p className="mt-4 text-sm text-muted-foreground">
                    Next batch: <span className="font-medium text-foreground">{row.nextBatchNumber}</span>
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
