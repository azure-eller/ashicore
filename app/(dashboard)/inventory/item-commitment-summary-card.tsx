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
    <div className="flex flex-col gap-(--space-1)">
      <dt className="font-mono text-[length:var(--text-xs)] font-semibold tracking-[var(--tracking-caps)] text-[var(--color-ink-faint)] uppercase">
        {label}
      </dt>
      <dd className="flex items-center gap-(--space-2) text-[length:var(--text-sm)] font-medium text-[var(--color-ink)]">
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
        <div className="flex flex-col gap-(--space-8)">
          <dl className="grid gap-x-(--space-8) gap-y-(--space-6) sm:grid-cols-2 lg:grid-cols-5">
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

          <div className="flex max-w-xl flex-col gap-(--space-3)">
            <h3 className="text-[length:var(--text-sm)] font-medium text-[var(--color-ink)]">On-hand stock breakdown</h3>
            {summary.slices.length > 0 ? (
              <InventoryCommitmentDonut
                slices={summary.slices}
                onHandQty={summary.onHandQty}
                unitName={summary.unitName}
              />
            ) : (
              <p className="text-[length:var(--text-sm)] text-[var(--color-ink-faint)]">No on-hand stock to chart.</p>
            )}
            {message ? <p className="text-[length:var(--text-sm)] text-[var(--color-ink-faint)]">{message}</p> : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
