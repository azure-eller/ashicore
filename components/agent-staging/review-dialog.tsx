"use client";

import { useEffect } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ShoppingCart01Icon,
  PackageIcon,
  FactoryIcon,
  WarehouseIcon,
  Note02Icon,
} from "@hugeicons/core-free-icons";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AgentProposal } from "@/lib/agent/chat/proposals";
import {
  useAgentStaging,
  type LinePatch,
  type StagedAction,
} from "@/components/agent-staging/staging-provider";

const MODULE_ICON: Record<string, typeof Note02Icon> = {
  sales: ShoppingCart01Icon,
  purchasing: PackageIcon,
  manufacturing: FactoryIcon,
  inventory: WarehouseIcon,
};

function formatMoney(value: string): string {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? parsed.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : value;
}

const HEAD_CLASS =
  "px-(--space-3) py-(--space-2) text-left font-mono text-[length:var(--text-2xs)] font-semibold tracking-[var(--tracking-caps)] text-[var(--color-ink-faint)] uppercase";
const NUM_INPUT_CLASS =
  "h-(--height-input-sm) w-[6rem] text-right font-mono text-[length:var(--text-xs)]";

function ProposalSection({
  action,
  onEditLine,
}: {
  action: StagedAction;
  onEditLine: (lineIndex: number, patch: LinePatch) => void;
}) {
  const { proposal }: { proposal: AgentProposal } = action;
  const icon = MODULE_ICON[proposal.module] ?? Note02Icon;
  const verb = proposal.method === "POST" ? "create" : "update";
  const table = proposal.lineTable;

  return (
    <section className="overflow-hidden rounded-(--radius-lg) border border-[var(--color-line)]">
      <div className="flex items-center justify-between gap-(--space-4) border-b border-[var(--color-line)] bg-[var(--color-surface-sunk)] px-(--space-4) py-(--space-3)">
        <div className="flex min-w-0 items-center gap-(--space-3) font-mono text-[length:var(--text-2xs)] font-semibold tracking-[var(--tracking-caps)] text-[var(--color-ink-faint)] uppercase">
          <HugeiconsIcon icon={icon} strokeWidth={2} className="size-(--space-4) shrink-0" />
          <span className="truncate">{proposal.title}</span>
        </div>
        <Badge variant="outline">{verb}</Badge>
      </div>

      {proposal.fields.length > 0 ? (
        <dl className="divide-y divide-[var(--color-line-soft)]">
          {proposal.fields.map((field) => (
            <div
              key={field.label}
              className="flex items-baseline justify-between gap-(--space-4) px-(--space-4) py-(--space-2)"
            >
              <dt className="shrink-0 font-mono text-[length:var(--text-2xs)] tracking-[var(--tracking-caps)] text-[var(--color-ink-faint)] uppercase">
                {field.label}
              </dt>
              <dd className="min-w-0 truncate text-right text-[length:var(--text-sm)] text-[var(--color-ink)]">
                {field.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      {table ? (
        <>
          <table className="w-full border-t border-[var(--color-line-soft)] text-[length:var(--text-sm)]">
            <thead>
              <tr className="border-b border-[var(--color-line-soft)]">
                <th className={HEAD_CLASS}>Item</th>
                <th className={HEAD_CLASS}>{table.quantityLabel}</th>
                <th className={HEAD_CLASS}>{table.unitAmountLabel}</th>
                <th className={`${HEAD_CLASS} text-right`}>Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-line-soft)]">
              {table.lines.map((line, index) => (
                <tr key={`${line.label}-${index}`}>
                  <td className="px-(--space-3) py-(--space-3)">
                    <div className="truncate text-[var(--color-ink)]">{line.label}</div>
                    {line.sublabel ? (
                      <div className="truncate font-mono text-[length:var(--text-2xs)] text-[var(--color-ink-faint)]">
                        {line.sublabel}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-(--space-3) py-(--space-3)">
                    <Input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      value={line.quantity}
                      aria-label={`Quantity for ${line.label}`}
                      onChange={(event) => onEditLine(index, { quantity: event.target.value })}
                      className={NUM_INPUT_CLASS}
                    />
                  </td>
                  <td className="px-(--space-3) py-(--space-3)">
                    <Input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      value={line.unitAmount}
                      aria-label={`${table.unitAmountLabel} for ${line.label}`}
                      onChange={(event) => onEditLine(index, { unitAmount: event.target.value })}
                      className={NUM_INPUT_CLASS}
                    />
                  </td>
                  <td className="px-(--space-3) py-(--space-3) text-right font-mono tabular-nums text-[var(--color-ink)]">
                    {formatMoney(line.lineTotal)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="flex items-center justify-between gap-(--space-4) border-t border-[var(--color-line)] bg-[var(--color-surface-sunk)] px-(--space-4) py-(--space-3)">
            <span className="font-mono text-[length:var(--text-2xs)] tracking-[var(--tracking-caps)] text-[var(--color-ink-faint)] uppercase">
              {table.totalLabel}
            </span>
            <span className="font-mono text-[length:var(--text-sm)] font-semibold tabular-nums text-[var(--color-ink)]">
              {formatMoney(table.total)}
            </span>
          </div>
        </>
      ) : null}

      {action.status === "failed" && action.error ? (
        <div className="border-t border-[var(--status-danger-divider)] bg-[var(--status-danger-bg)] px-(--space-4) py-(--space-2) text-[length:var(--text-xs)] text-[var(--status-danger-ink)]">
          {action.error}
        </div>
      ) : null}
    </section>
  );
}

export function ReviewDialog() {
  const { actions, reviewOpen, closeReview, editLine, discardAll, approveAll } = useAgentStaging();
  const staged = actions.filter((action) => action.status === "staged");

  useEffect(() => {
    if (!reviewOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        approveAll();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [reviewOpen, approveAll]);

  return (
    <Dialog open={reviewOpen} onOpenChange={(next) => (next ? null : closeReview())}>
      <DialogContent size="3xl" className="gap-(--space-6)">
        <DialogHeader className="flex-row items-center gap-(--space-3)">
          <DialogTitle>Review changes</DialogTitle>
          <Badge variant="outline">{staged.length}</Badge>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-(--space-5) overflow-y-auto">
          {staged.length === 0 ? (
            <p className="py-(--space-8) text-center text-[length:var(--text-sm)] text-[var(--color-ink-faint)]">
              Nothing staged to review.
            </p>
          ) : (
            staged.map((action) => (
              <ProposalSection
                key={action.id}
                action={action}
                onEditLine={(lineIndex, patch) => editLine(action.id, lineIndex, patch)}
              />
            ))
          )}
        </div>

        <DialogFooter className="flex-row items-center justify-between gap-(--space-4)">
          <Button
            type="button"
            variant="ghost"
            onClick={discardAll}
            disabled={staged.length === 0}
            className="text-[var(--status-danger-ink)]"
          >
            Discard all
          </Button>
          <div className="flex items-center gap-(--space-3)">
            <Button type="button" variant="outline" onClick={closeReview}>
              Keep for later
            </Button>
            <Button type="button" onClick={approveAll} disabled={staged.length === 0}>
              Approve {staged.length} change{staged.length === 1 ? "" : "s"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
