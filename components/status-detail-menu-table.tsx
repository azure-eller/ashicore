import { cn } from "@/lib/utils";

export type StatusDetailMenuTableRow = {
  id: string;
  item: string;
  needed: string;
  available: string;
  expected?: string;
  short?: boolean;
};

export function StatusDetailMenuTable({
  emptyMessage,
  rows,
}: {
  emptyMessage: string;
  rows: StatusDetailMenuTableRow[];
}) {
  const showExpected = rows.some((row) => Number.parseFloat(row.expected ?? "0") > 0);
  const gridTemplate = showExpected
    ? "grid-cols-[minmax(0,1fr)_64px_64px_92px]"
    : "grid-cols-[minmax(0,1fr)_64px_64px]";

  if (rows.length === 0) {
    return (
      <div className="px-(--space-3) py-(--space-4) text-[length:var(--text-sm)] text-[var(--color-ink-faint)]">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="max-h-[320px] overflow-y-auto">
      <div
        className={cn(
          "grid gap-x-(--space-5) border-b border-[var(--color-line)] bg-[var(--color-surface-alt)] px-(--space-3) py-(--space-2) font-mono text-[length:var(--text-xs)] font-medium uppercase tracking-[var(--tracking-caps)] text-[var(--color-ink-faint)]",
          gridTemplate,
        )}
      >
        <div>Item</div>
        <div className="text-right">Needed</div>
        <div className="text-right">Available</div>
        {showExpected ? <div className="text-right">Expected</div> : null}
      </div>
      {rows.map((row) => {
        const valueClassName = row.short
          ? "text-[var(--status-danger-ink)]"
          : "text-[var(--color-ink-faint)]";

        return (
          <div
            key={row.id}
            className={cn(
              "grid items-start gap-x-(--space-5) border-b border-[var(--color-line-soft)] px-(--space-3) py-(--space-3) text-[length:var(--text-sm)] last:border-b-0",
              row.short && "text-[var(--status-danger-ink)]",
              gridTemplate,
            )}
          >
            <div className="min-w-0 truncate font-medium">{row.item}</div>
            <div
              className={cn(
                "text-right font-mono text-[length:var(--text-xs)] tabular-nums",
                valueClassName,
              )}
            >
              {row.needed}
            </div>
            <div
              className={cn(
                "text-right font-mono text-[length:var(--text-xs)] tabular-nums",
                valueClassName,
              )}
            >
              {row.available}
            </div>
            {showExpected ? (
              <div className="min-w-0 text-right font-mono text-[length:var(--text-xs)] tabular-nums text-[var(--color-ink-faint)]">
                {row.expected ?? "0"}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
