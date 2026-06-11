"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ICellRendererParams, ValueSetterParams } from "ag-grid-community";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { DateTimeText } from "@/components/date-time-text";
import {
  FixedEditableLines,
  type EditableLineDataGridChange,
  type LineField,
} from "@/components/editable-lines";
import { ActiveVariantSelect } from "@/components/card-page/active-variant-select";
import { CardSection } from "@/components/card-page/card-page";
import { apiJson } from "@/lib/client/api";
import { LotDispositionActions } from "@/app/(dashboard)/inventory/lot-disposition-actions";
import type { InventoryDisposition } from "@/lib/db/schema";
import {
  ADJUSTMENT_REASONS,
  formatAdjustmentReason,
  type AdjustmentReason,
} from "@/lib/inventory/adjustment-reasons";
import {
  formatCost,
  formatInventoryDisposition,
  formatQuantity,
  normalizeNumeric,
  parseQuantity,
} from "@/lib/format";
import { isNonNegativeNumberString } from "@/lib/schemas/shared";
import type { ItemCardDto } from "@/lib/api/clients/item-cards";
import { useOptionalItemCardContext } from "@/components/card-page/item-card-focus-context";
import styles from "./card-page.module.css";

export type CardLotRow = {
  id: string;
  lotNumber: string;
  quantity: string;
  costPerUnit: string | null;
  receivedAt: Date | string;
  allocations: Array<{
    type: "sales_order" | "manufacturing_order";
    label: string;
    contextLabel: string | null;
    href: string;
    quantity: string;
  }>;
  dispositionBalances: Array<{
    disposition: "available" | "blocked" | "rejected";
    quantity: string;
  }>;
};

export type LotGridTabProps = {
  card?: ItemCardDto;
  focusItemId: string;
  lots: CardLotRow[];
  unitLabel?: string | null;
  lotTrackingLocked?: boolean;
};

type PendingAdjustment = {
  lotId: string;
  lotNumber: string;
  currentQuantity: string;
  quantity: string;
};

function cloneLotRows(rows: CardLotRow[]) {
  return rows.map((row) => ({
    ...row,
    allocations: row.allocations.map((allocation) => ({ ...allocation })),
    dispositionBalances: row.dispositionBalances.map((balance) => ({ ...balance })),
  }));
}

function lotNumberLabel(lotNumber: string) {
  return lotNumber === "UNBATCHED-NEGATIVE-STOCK"
    ? "Unbatched negative stock"
    : lotNumber;
}

function normalizeEditedQuantity(value: unknown) {
  const trimmed = typeof value === "string" ? value.trim() : String(value ?? "").trim();
  if (!trimmed || !isNonNegativeNumberString(trimmed)) return null;
  const parsed = Number(trimmed);
  return normalizeNumeric(parsed);
}

function LotNumberCell({ data }: ICellRendererParams<CardLotRow>) {
  if (!data) return null;
  const balances = data.dispositionBalances.filter(
    (balance) => parseQuantity(balance.quantity) > 0,
  );
  const hasNegativeBalance = parseQuantity(data.quantity) < 0;
  return (
    <div className="flex h-full min-w-0 items-center gap-(--space-2)">
      <span className={`${styles.mono} truncate`}>{lotNumberLabel(data.lotNumber)}</span>
      {hasNegativeBalance ? (
        <span className="shrink-0">
          <Badge variant="destructive">Negative stock</Badge>
        </span>
      ) : null}
      {balances.map((balance) => (
        <span key={`${data.id}-${balance.disposition}`} className="shrink-0">
          <Badge
            variant={
              balance.disposition === "available"
                ? "success"
                : balance.disposition === "rejected"
                  ? "destructive"
                  : "secondary"
            }
          >
            {formatInventoryDisposition(balance.disposition)}
          </Badge>
        </span>
      ))}
    </div>
  );
}

function AllocationsCell({ data }: ICellRendererParams<CardLotRow>) {
  if (!data || data.allocations.length === 0) {
    return <span className={styles.placeholder}>—</span>;
  }

  return (
    <div className="flex h-full min-w-0 flex-wrap items-center gap-x-(--space-2) gap-y-(--space-1) overflow-hidden">
      {data.allocations.map((allocation) => (
        <Link
          key={`${data.id}-${allocation.type}-${allocation.label}-${allocation.quantity}`}
          href={allocation.href}
          className="inline-flex max-w-full items-center gap-(--space-1) overflow-hidden whitespace-nowrap underline-offset-4 hover:underline"
          title={`${formatQuantity(allocation.quantity)} claimed by ${allocation.label}${allocation.contextLabel ? ` · ${allocation.contextLabel}` : ""}`}
        >
          <span className={styles.mono}>{formatQuantity(allocation.quantity)}</span>
          <span className="truncate">
            {allocation.label}
          </span>
          {allocation.contextLabel ? (
            <span className="truncate text-[var(--color-ink-faint)]">{allocation.contextLabel}</span>
          ) : null}
        </Link>
      ))}
    </div>
  );
}

export function LotGridTab({
  card: cardProp,
  focusItemId,
  lots,
  lotTrackingLocked = false,
}: LotGridTabProps) {
  const router = useRouter();
  const cardContext = useOptionalItemCardContext();
  const card = cardContext?.card ?? cardProp;
  if (!card) {
    throw new Error("LotGridTab requires a card prop or ItemCardProvider");
  }
  const visibleVariants = useMemo(
    () => card.variants.filter((variant) => variant.deletedAt == null),
    [card.variants],
  );
  const activeVariant =
    visibleVariants.find((variant) => variant.id === focusItemId) ?? visibleVariants[0];
  const visibleLots = lots;
  const [rows, setRows] = useState<CardLotRow[]>(() => cloneLotRows(visibleLots));
  const [lastSynced, setLastSynced] = useState(visibleLots);
  const [pendingAdjustment, setPendingAdjustment] = useState<PendingAdjustment | null>(
    null,
  );
  const [adjustmentReason, setAdjustmentReason] = useState<AdjustmentReason | "">("");
  const [adjustmentNote, setAdjustmentNote] = useState("");
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  if (lastSynced !== visibleLots) {
    setLastSynced(visibleLots);
    setRows(cloneLotRows(visibleLots));
  }

  const resetRows = useCallback(() => {
    setRows(cloneLotRows(visibleLots));
    setPendingAdjustment(null);
    setAdjustmentReason("");
    setAdjustmentNote("");
  }, [visibleLots]);

  useEffect(() => {
    if (!successMessage) return;
    const timeout = window.setTimeout(() => setSuccessMessage(null), 3500);
    return () => window.clearTimeout(timeout);
  }, [successMessage]);

  const fields = useMemo<LineField<CardLotRow>[]>(
    () => [
      {
        field: "lotNumber",
        headerName: "Lot number",
        kind: "display",
        flex: 1.35,
        minWidth: 230,
        cellRenderer: LotNumberCell,
      },
      {
        field: "quantity",
        headerName: "On hand",
        kind: "number",
        rightAligned: true,
        flex: 0.8,
        minWidth: 130,
        editable: (row) => row?.lotNumber !== "UNBATCHED-NEGATIVE-STOCK",
        mono: true,
        cellClass: ({ data }) =>
          data && parseQuantity(data.quantity) < 0 ? "text-[var(--status-danger-ink)]" : null,
        valueFormatter: ({ value }) => formatQuantity(String(value ?? "0")),
        valueSetter: (params: ValueSetterParams<CardLotRow>) => {
          const next = normalizeEditedQuantity(params.newValue);
          if (next == null || next === params.data.quantity) return false;
          params.data.quantity = next;
          return true;
        },
      },
      {
        colId: "free",
        headerName: "Free",
        kind: "display",
        rightAligned: true,
        flex: 0.7,
        minWidth: 110,
        mono: true,
        valueGetter: ({ data }) => {
          if (!data) return "0";
          const availableQuantity = data.dispositionBalances
            .filter((balance) => balance.disposition === "available")
            .reduce((sum, balance) => sum + parseQuantity(balance.quantity), 0);
          const claimedQuantity = data.allocations.reduce(
            (sum, allocation) => sum + parseQuantity(allocation.quantity),
            0,
          );
          return normalizeNumeric(availableQuantity - claimedQuantity);
        },
        valueFormatter: ({ value }) => formatQuantity(String(value ?? "0")),
      },
      {
        colId: "claimedBy",
        headerName: "Claimed by",
        kind: "display",
        flex: 1.4,
        minWidth: 220,
        cellRenderer: AllocationsCell,
      },
      {
        field: "costPerUnit",
        headerName: "Cost / unit",
        kind: "display",
        rightAligned: true,
        flex: 0.75,
        minWidth: 120,
        mono: true,
        valueFormatter: ({ value }) => formatCost(value == null ? null : String(value)) ?? "—",
      },
      {
        field: "receivedAt",
        headerName: "Received",
        kind: "display",
        rightAligned: true,
        flex: 0.9,
        minWidth: 150,
        cellRenderer: ({ value }: ICellRendererParams<CardLotRow>) =>
          value ? <DateTimeText value={value as Date | string} /> : "—",
      },
      {
        colId: "lotActions",
        headerName: "",
        kind: "display",
        width: 48,
        minWidth: 48,
        maxWidth: 48,
        sortable: false,
        resizable: false,
        cellRenderer: ({ data }: ICellRendererParams<CardLotRow>) => {
          if (!data || !activeVariant) return null;
          const balances = data.dispositionBalances
            .filter((balance) => parseQuantity(balance.quantity) > 0)
            .map((balance) => ({
              disposition: balance.disposition as InventoryDisposition,
              quantity: balance.quantity,
            }));
          if (balances.length === 0) return null;
          return (
            <div className="flex h-full items-center justify-center">
              <LotDispositionActions
                itemId={activeVariant.id}
                lotId={data.id}
                balances={balances}
                locked={lotTrackingLocked}
              />
            </div>
          );
        },
      },
    ],
    [activeVariant, lotTrackingLocked],
  );

  const handleVariantChange = (nextVariantId: string) => {
    if (nextVariantId === focusItemId) return;
    const segment = card.family.itemType === "material" ? "materials" : "products";
    router.push(
      card.family.itemType === "product"
        ? `/inventory/${segment}/${nextVariantId}/lots`
        : `/inventory/${segment}/${nextVariantId}?tab=lots`,
    );
  };

  useEffect(() => {
    const segment = card.family.itemType === "material" ? "materials" : "products";
    for (const variant of visibleVariants) {
      if (variant.id === focusItemId) continue;
      router.prefetch(
        card.family.itemType === "product"
          ? `/inventory/${segment}/${variant.id}/lots`
          : `/inventory/${segment}/${variant.id}?tab=lots`,
      );
    }
  }, [card.family.itemType, focusItemId, router, visibleVariants]);

  const handleRowsChange = (
    nextRows: CardLotRow[],
    change: EditableLineDataGridChange<CardLotRow>,
  ) => {
    setRows(nextRows);
    if (
      change.type !== "cell_edit_committed" ||
      change.field !== "quantity" ||
      !change.row
    ) {
      return;
    }

    setError(null);
    setSuccessMessage(null);
    const currentLot = visibleLots.find((lot) => lot.id === change.row?.id);
    setPendingAdjustment({
      lotId: change.row.id,
      lotNumber: change.row.lotNumber,
      currentQuantity: currentLot?.quantity ?? "0",
      quantity: change.row.quantity,
    });
  };

  const submitAdjustment = async () => {
    if (!pendingAdjustment) return;
    if (!adjustmentReason) {
      setError("Choose a reason.");
      return;
    }
    setIsSaving(true);
    setError(null);

    try {
      await apiJson<void>(`/api/items/${focusItemId}/stock-adjustments`, {
        method: "POST",
        body: {
          reason: adjustmentReason,
          note: adjustmentNote.trim() || undefined,
          lots: [
            {
              lotId: pendingAdjustment.lotId,
              newQuantity: pendingAdjustment.quantity,
            },
          ],
        },
        idempotencyKey: "item-stock-adjust",
        fallbackError: "Failed to adjust lot quantity.",
      });
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Failed to adjust lot quantity.",
      );
      resetRows();
      setIsSaving(false);
      return;
    }

    setIsSaving(false);
    setSuccessMessage(
      `${lotNumberLabel(pendingAdjustment.lotNumber)} adjusted.`
    );
    setPendingAdjustment(null);
    setAdjustmentReason("");
    setAdjustmentNote("");
    router.refresh();
  };

  const totalQuantity = useMemo(
    () =>
      normalizeNumeric(
        visibleLots.reduce((sum, lot) => sum + parseQuantity(lot.quantity), 0)
      ),
    [visibleLots]
  );
  const pendingVariance =
    pendingAdjustment == null
      ? null
      : normalizeNumeric(
          parseQuantity(pendingAdjustment.quantity) -
            parseQuantity(pendingAdjustment.currentQuantity)
        );

  return (
    <CardSection
      title="Lots"
      count={`· ${formatQuantity(totalQuantity)} on hand`}
    >
      <div className="mb-(--space-3)">
        <ActiveVariantSelect
          variants={visibleVariants}
          value={focusItemId}
          onChange={handleVariantChange}
          hideWhenSingle
        />
      </div>

      <FixedEditableLines<CardLotRow>
        rows={rows}
        fields={fields}
        getRowId={(row) => row.id}
        createRow={() => visibleLots[0] ?? rows[0]}
        onRowsChange={handleRowsChange}
        emptyMessage="No lots yet."
        error={error}
      />
      <AlertDialog
        open={pendingAdjustment != null}
        onOpenChange={(open) => {
          if (!open) resetRows();
        }}
      >
        <AlertDialogContent
          size="sm"
          onEscapeKeyDown={(event) => event.preventDefault()}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Adjust this lot?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingAdjustment && pendingVariance
                ? `${lotNumberLabel(pendingAdjustment.lotNumber)} ${formatQuantity(
                    pendingAdjustment.currentQuantity
                  )} → ${formatQuantity(pendingAdjustment.quantity)}, ${formatQuantity(
                    pendingVariance
                  )}. This writes a manual adjustment event.`
                : "This writes a manual adjustment event."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-(--space-4)">
            <Field>
              <FieldLabel>Reason</FieldLabel>
              <div className="flex flex-wrap gap-(--space-2)" aria-label="Adjustment reason">
                {ADJUSTMENT_REASONS.map((reason) => (
                  <Button
                    key={reason}
                    type="button"
                    variant={adjustmentReason === reason ? "default" : "outline"}
                    size="sm"
                    onClick={() => setAdjustmentReason(reason)}
                  >
                    {formatAdjustmentReason(reason)}
                  </Button>
                ))}
              </div>
            </Field>
            <Field>
              <FieldLabel>Note</FieldLabel>
              <Textarea
                value={adjustmentNote}
                onChange={(event) => setAdjustmentNote(event.target.value)}
                maxLength={500}
                aria-label="Adjustment note"
              />
            </Field>
          </div>
          {error ? <p className="text-[length:var(--text-sm)] text-[var(--status-danger-ink)]">{error}</p> : null}
          <AlertDialogFooter>
            <AlertDialogCancel onClick={resetRows}>Back</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void submitAdjustment();
              }}
              disabled={isSaving}
            >
              {isSaving ? "Adjusting..." : "Adjust Lot"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {successMessage ? (
        <div
          role="status"
          className="fixed right-(--space-6) bottom-(--space-6) z-50 border border-border bg-popover px-(--space-5) py-(--space-3) text-[length:var(--text-sm)] text-popover-foreground shadow-[var(--shadow-overlay)]"
        >
          {successMessage}
        </div>
      ) : null}
    </CardSection>
  );
}
