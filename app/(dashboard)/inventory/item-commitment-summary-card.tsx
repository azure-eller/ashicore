import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatQuantity } from "@/lib/format";
import type { ItemCommitmentSummary } from "./commitment-summary";
import { InventoryCommitmentDonut } from "./inventory-commitment-donut";

type ItemCommitmentSummaryCardProps = {
  summary: ItemCommitmentSummary;
};

function quantityValue(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function quantityWithUnit(value: string, unitName: string | null) {
  return `${formatQuantity(value)} ${unitName ?? "units"}`;
}

function CommitmentStat({
  label,
  value,
  unitName,
  highlight,
}: {
  label: string;
  value: string;
  unitName: string | null;
  highlight?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="flex items-center gap-2 text-sm font-medium">
        <span>{quantityWithUnit(value, unitName)}</span>
        {highlight ? <Badge variant="warning">Shortfall</Badge> : null}
      </dd>
    </div>
  );
}

function getCommitmentMessage(summary: ItemCommitmentSummary) {
  const onHandQty = quantityValue(summary.onHandQty);
  const availableQty = quantityValue(summary.availableQty);
  const committedQty = quantityValue(summary.committedQty);

  if (onHandQty <= 0 && committedQty <= 0) {
    return "No on-hand or committed stock for this item.";
  }

  if (onHandQty <= 0 && committedQty > 0) {
    return `No stock available. ${quantityWithUnit(summary.committedQty, summary.unitName)} committed.`;
  }

  if (availableQty <= 0 && committedQty > 0) {
    return "All on-hand stock is reserved.";
  }

  if (availableQty > 0 && committedQty <= 0) {
    return "All available stock is uncommitted.";
  }

  return null;
}

export function ItemCommitmentSummaryCard({
  summary,
}: ItemCommitmentSummaryCardProps) {
  const shortageQty = quantityValue(summary.shortageQty);
  const message = getCommitmentMessage(summary);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Stock Commitments</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-5">
          <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-5">
            <CommitmentStat
              label="On hand"
              value={summary.onHandQty}
              unitName={summary.unitName}
            />
            <CommitmentStat
              label="Available"
              value={summary.availableQty}
              unitName={summary.unitName}
            />
            <CommitmentStat
              label="Committed"
              value={summary.committedQty}
              unitName={summary.unitName}
            />
            <CommitmentStat
              label="Demand"
              value={summary.demandQty}
              unitName={summary.unitName}
            />
            <CommitmentStat
              label="Shortfall"
              value={summary.shortageQty}
              unitName={summary.unitName}
              highlight={shortageQty > 0}
            />
          </dl>

          <div className="flex max-w-xl flex-col gap-2">
            <h3 className="text-sm font-medium">On-hand stock breakdown</h3>
            {summary.slices.length > 0 ? (
              <InventoryCommitmentDonut
                slices={summary.slices}
                onHandQty={summary.onHandQty}
                unitName={summary.unitName}
              />
            ) : (
              <p className="text-sm text-muted-foreground">No on-hand stock to chart.</p>
            )}
            {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
