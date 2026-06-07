"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { QuantityWithUnit } from "@/components/quantity-with-unit";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  FramedTable,
  FramedTableBody,
  FramedTableCell,
  FramedTableHeaderCell,
  FramedTableHead,
  FramedTableRow,
  TableFrame,
} from "@/components/table-frame";
import { TooltipHeader } from "@/components/tooltip-header";
import { BOM_QTY_PER_UNIT_TOOLTIP } from "@/lib/tooltip-copy";
import {
  formatMinimumLotAgeRequirement,
  getMinimumLotAgeDays,
  type BomComponentConstraint,
} from "@/lib/bom/constraints";
import { formatDate, toDateOnlyString } from "@/lib/format";
import { cn } from "@/lib/utils";

export type BomRevisionHistoryComponent = {
  id: string;
  componentId: string;
  componentName: string;
  componentItemType: string;
  unitName: string;
  quantity: string;
  constraints: BomComponentConstraint[];
};

export type BomRevisionHistoryEntry = {
  id: string;
  revisionNumber: number;
  isCurrent: boolean;
  note: string | null;
  createdByName: string | null;
  createdAt: Date | string;
  components: BomRevisionHistoryComponent[];
};

type BomRevisionHistorySheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productName: string;
  revisions: BomRevisionHistoryEntry[];
};

export function BomRevisionHistorySheet({
  open,
  onOpenChange,
  productName,
  revisions,
}: BomRevisionHistorySheetProps) {
  const [selectedRevisionId, setSelectedRevisionId] = useState<string | null>(
    revisions[0]?.id ?? null,
  );

  const selectedRevision = useMemo(() => {
    return (
      revisions.find((revision) => revision.id === selectedRevisionId) ??
      revisions[0] ??
      null
    );
  }, [revisions, selectedRevisionId]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="data-[side=right]:w-[min(90vw,1120px)] data-[side=right]:sm:max-w-none gap-(--space-4)"
      >
        <SheetHeader className="border-b border-[var(--color-line)]">
          <SheetTitle>Recipe history</SheetTitle>
          <SheetDescription>{productName}</SheetDescription>
        </SheetHeader>

        {selectedRevision ? (
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-(--space-4) overflow-hidden px-(--space-8) pb-(--space-8) lg:grid-cols-[150px_minmax(0,1fr)]">
            <div
              className="flex gap-(--space-2) overflow-x-auto border-b border-[var(--color-line)] pb-(--space-3) lg:flex-col lg:overflow-x-visible lg:border-b-0 lg:border-r lg:pr-(--space-3)"
              aria-label="BOM revisions"
            >
              {revisions.map((revision) => {
                const isSelected = revision.id === selectedRevision.id;

                return (
                  <Button
                    key={revision.id}
                    type="button"
                    variant="ghost"
                    className={cn(
                      "h-auto shrink-0 justify-start px-(--space-3) py-(--space-2) text-left lg:w-full",
                      isSelected
                        ? "bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)]"
                        : "text-[var(--color-ink-faint)] hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-ink)]",
                    )}
                    aria-pressed={isSelected}
                    onClick={() => setSelectedRevisionId(revision.id)}
                  >
                    <span className="flex min-w-0 flex-col gap-(--space-1)">
                      <span className="flex items-center gap-(--space-2)">
                        <span className="font-medium">
                          Rev {revision.revisionNumber}
                        </span>
                        {revision.isCurrent ? (
                          <Badge variant="secondary">Current</Badge>
                        ) : null}
                      </span>
                      <span className="text-[length:var(--text-xs)] text-[var(--color-ink-faint)]">
                        {formatDate(toDateOnlyString(revision.createdAt))}
                      </span>
                    </span>
                  </Button>
                );
              })}
            </div>

            <div className="min-w-0 overflow-y-auto">
              <div className="mb-(--space-4) space-y-(--space-1)">
                <div className="flex items-center gap-(--space-2)">
                  <h3 className="text-[length:var(--text-lg)] font-semibold leading-[var(--leading-lg)]">
                    Revision {selectedRevision.revisionNumber}
                  </h3>
                  {selectedRevision.isCurrent ? (
                    <Badge variant="secondary">Current</Badge>
                  ) : null}
                </div>
                <p className="text-[length:var(--text-sm)] text-[var(--color-ink-faint)]">
                  {formatDate(toDateOnlyString(selectedRevision.createdAt))}
                  {selectedRevision.createdByName
                    ? ` by ${selectedRevision.createdByName}`
                    : ""}
                </p>
                {selectedRevision.note ? (
                  <p className="text-[length:var(--text-sm)] text-[var(--color-ink-faint)]">
                    {selectedRevision.note}
                  </p>
                ) : null}
              </div>

              <TableFrame>
                <FramedTable>
                  <FramedTableHead>
                    <FramedTableRow>
                      <FramedTableHeaderCell>Component</FramedTableHeaderCell>
                      <FramedTableHeaderCell>Type</FramedTableHeaderCell>
                      <FramedTableHeaderCell align="right">
                        <TooltipHeader label="Qty" tooltip={BOM_QTY_PER_UNIT_TOOLTIP} />
                      </FramedTableHeaderCell>
                      <FramedTableHeaderCell>Requirements</FramedTableHeaderCell>
                    </FramedTableRow>
                  </FramedTableHead>
                  <FramedTableBody>
                    {selectedRevision.components.map((component) => {
                      const minimumLotAgeDays = getMinimumLotAgeDays(
                        component.constraints,
                      );

                      return (
                        <FramedTableRow key={component.id}>
                          <FramedTableCell strong>
                            {component.componentName}
                          </FramedTableCell>
                          <FramedTableCell>
                            <Badge variant="outline">
                              {component.componentItemType}
                            </Badge>
                          </FramedTableCell>
                          <FramedTableCell align="right">
                            <QuantityWithUnit
                              value={component.quantity}
                              unitName={component.unitName}
                              className="justify-end"
                            />
                          </FramedTableCell>
                          <FramedTableCell muted>
                            {minimumLotAgeDays
                              ? formatMinimumLotAgeRequirement(minimumLotAgeDays)
                              : "\u2014"}
                          </FramedTableCell>
                        </FramedTableRow>
                      );
                    })}
                  </FramedTableBody>
                </FramedTable>
              </TableFrame>
            </div>
          </div>
        ) : (
          <div className="px-(--space-8) pb-(--space-8) text-[length:var(--text-sm)] text-[var(--color-ink-faint)]">
            No BOM revisions yet.
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
