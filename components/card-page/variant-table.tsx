"use client";

import { useCallback, useMemo, useState } from "react";
import type { ICellRendererParams, ValueSetterParams } from "ag-grid-community";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon, Delete02Icon } from "@hugeicons/core-free-icons";
import {
  EditableLineDataGrid,
  type ColDef,
  type EditableLineDataGridChange,
} from "@/components/editable-line-data-grid";
import {
  deleteVariant,
  updateItemCardVariant,
  type ItemCardDto,
  type ItemCardVariantDto,
  type UpdateItemCardVariantInput,
} from "@/lib/api/clients/item-cards";
import { cn } from "@/lib/utils";
import styles from "./card-page.module.css";

export type VariantTableProps = {
  card: ItemCardDto;
  viewMode: "product" | "material";
  onAddInitialStock?: (variant: ItemCardVariantDto) => void;
  addInitialStockEndpointReady?: boolean;
};

/**
 * Maps a colDef field touched by AG Grid to the matching variant PATCH
 * payload. Numeric fields are coerced to the API's expected primitive.
 */
function buildVariantPatch(
  field: string,
  next: unknown,
): UpdateItemCardVariantInput | null {
  const value = typeof next === "string" ? next.trim() : next;
  const blank = value == null || value === "";

  switch (field) {
    case "sku":
    case "registeredBarcode":
    case "internalBarcode":
    case "supplierItemCode":
      return { [field]: blank ? null : String(value) } as UpdateItemCardVariantInput;
    case "defaultLeadTimeDays": {
      if (blank) return { defaultLeadTimeDays: null };
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < 0) return null;
      return { defaultLeadTimeDays: Math.trunc(parsed) };
    }
    case "minimumOrderQuantity": {
      if (blank) return { minimumOrderQuantity: null };
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed <= 0) return null;
      return { minimumOrderQuantity: String(value) };
    }
    default:
      return null;
  }
}

export function VariantTable({
  card,
  viewMode,
  onAddInitialStock,
  addInitialStockEndpointReady = false,
}: VariantTableProps) {
  const activeOptions = card.options.filter((option) => option.disabledAt == null);
  const visibleVariants = useMemo(
    () => card.variants.filter((variant) => variant.deletedAt == null),
    [card.variants],
  );

  // Local copy of the rows AG Grid renders. Sync from props on every render
  // via the "adjust state in render" pattern (React 19-recommended).
  const [rows, setRows] = useState<ItemCardVariantDto[]>(visibleVariants);
  const [lastSynced, setLastSynced] = useState(visibleVariants);
  if (lastSynced !== visibleVariants) {
    setLastSynced(visibleVariants);
    setRows(visibleVariants);
  }

  const queryClient = useQueryClient();
  const [confirmDeleteVariant, setConfirmDeleteVariant] =
    useState<ItemCardVariantDto | null>(null);

  const cellMutation = useMutation({
    // mutationKey prefix matches the card's useQuery so the save-status pill
    // picks up edits across every variant in the family.
    mutationKey: ["item-card", card.variants[0]?.id ?? card.family.id, "variant-cell"],
    mutationFn: ({
      variantId,
      payload,
    }: {
      variantId: string;
      payload: UpdateItemCardVariantInput;
    }) => updateItemCardVariant(variantId, payload),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["item-card"] });
    },
  });

  const deleteMutation = useMutation({
    mutationKey: ["item-card", card.variants[0]?.id ?? card.family.id, "variant-delete"],
    mutationFn: (variantId: string) => deleteVariant(variantId),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["item-card"] });
    },
  });

  const handleRowsChange = useCallback(
    (next: ItemCardVariantDto[], change: EditableLineDataGridChange<ItemCardVariantDto>) => {
      setRows(next);
      if (change.type !== "cell_edit_committed" || !change.row || !change.field) return;
      const payload = buildVariantPatch(change.field, change.newValue);
      if (!payload) return;
      cellMutation.mutate({ variantId: change.row.id, payload });
    },
    [cellMutation],
  );

  const columns = ((): ColDef<ItemCardVariantDto>[] => {
    const cols: ColDef<ItemCardVariantDto>[] = [];

    // Option-value columns — read-only pills.
    for (const option of activeOptions) {
      cols.push({
        colId: `option:${option.id}`,
        headerName: option.name,
        flex: 1,
        minWidth: 96,
        cellRenderer: (params: ICellRendererParams<ItemCardVariantDto>) => {
          if (!params.data) return null;
          const assigned = params.data.optionValues.find(
            (value) => value.optionId === option.id,
          );
          if (!assigned) {
            return <span className={styles.placeholder}>—</span>;
          }
          return (
            <span
              className={cn(
                styles.sizePill,
                assigned.valueDisabledAt && styles.chipDisabled,
              )}
            >
              {assigned.valueLabel}
            </span>
          );
        },
        valueGetter: (params) => {
          const assigned = params.data?.optionValues.find(
            (value) => value.optionId === option.id,
          );
          return assigned?.valueLabel ?? "";
        },
      });
    }

    const textEditable = (field: keyof ItemCardVariantDto): ColDef<ItemCardVariantDto> => ({
      field,
      editable: true,
      cellEditor: "agTextCellEditor",
      cellClass: styles.mono,
      valueSetter: (params: ValueSetterParams<ItemCardVariantDto>) => {
        const trimmed =
          typeof params.newValue === "string"
            ? params.newValue.trim() || null
            : params.newValue;
        const current = (params.data as Record<string, unknown>)[field as string] ?? null;
        if (trimmed === current) return false;
        (params.data as Record<string, unknown>)[field as string] = trimmed;
        return true;
      },
    });

    cols.push({
      ...textEditable("sku"),
      headerName: "Variant code/SKU",
      flex: 1.1,
      minWidth: 140,
      cellEditorParams: { placeholder: "E.g. P-1, M-1" },
    });

    if (viewMode === "product") {
      cols.push({
        colId: "defaultSalesPrice",
        headerName: "Default sales price",
        type: "rightAligned",
        flex: 0.9,
        minWidth: 140,
        cellRenderer: () => (
          <>
            <span className={styles.placeholder}>—</span>
            <span className={styles.uom}>USD</span>
          </>
        ),
      });
    }

    cols.push({
      ...textEditable("registeredBarcode"),
      headerName: "Registered barcode",
      flex: 1,
      minWidth: 140,
    });
    cols.push({
      ...textEditable("internalBarcode"),
      headerName: "Internal barcode",
      flex: 1,
      minWidth: 140,
    });

    if (viewMode === "product") {
      cols.push({
        colId: "ingredientsCost",
        headerName: "Ingredients cost",
        type: "rightAligned",
        flex: 0.9,
        minWidth: 140,
        cellRenderer: () => (
          <>
            <span className={styles.placeholder}>—</span>
            <span className={styles.uom}>USD</span>
          </>
        ),
      });
      cols.push({
        colId: "operationsCost",
        headerName: "Operations cost",
        type: "rightAligned",
        flex: 0.9,
        minWidth: 140,
        cellRenderer: () => (
          <>
            <span className={styles.placeholder}>—</span>
            <span className={styles.uom}>USD</span>
          </>
        ),
      });
    }

    if (viewMode === "material") {
      cols.push({
        ...textEditable("supplierItemCode"),
        headerName: "Supplier item code",
        flex: 1,
        minWidth: 140,
      });
      cols.push({
        field: "defaultLeadTimeDays",
        headerName: "Lead time",
        type: "rightAligned",
        editable: true,
        cellEditor: "agNumberCellEditor",
        cellClass: styles.mono,
        flex: 0.6,
        minWidth: 100,
        valueSetter: (params: ValueSetterParams<ItemCardVariantDto>) => {
          const next = params.newValue;
          if (next === "" || next == null) {
            if (params.data.defaultLeadTimeDays == null) return false;
            params.data.defaultLeadTimeDays = null;
            return true;
          }
          const parsed = Number(next);
          if (!Number.isFinite(parsed) || parsed < 0) return false;
          const truncated = Math.trunc(parsed);
          if (params.data.defaultLeadTimeDays === truncated) return false;
          params.data.defaultLeadTimeDays = truncated;
          return true;
        },
      });
      cols.push({
        field: "minimumOrderQuantity",
        headerName: "MOQ",
        type: "rightAligned",
        editable: true,
        cellEditor: "agTextCellEditor",
        cellClass: styles.mono,
        flex: 0.6,
        minWidth: 100,
        valueSetter: (params: ValueSetterParams<ItemCardVariantDto>) => {
          const raw = params.newValue;
          if (raw === "" || raw == null) {
            if (params.data.minimumOrderQuantity == null) return false;
            params.data.minimumOrderQuantity = null;
            return true;
          }
          const trimmed = String(raw).trim();
          const parsed = Number(trimmed);
          if (!Number.isFinite(parsed) || parsed <= 0) return false;
          if (params.data.minimumOrderQuantity === trimmed) return false;
          params.data.minimumOrderQuantity = trimmed;
          return true;
        },
      });
    }

    // In stock — RO placeholder until backend extends DTO with lot balances.
    cols.push({
      colId: "inStock",
      headerName: "In stock",
      type: "rightAligned",
      flex: 0.8,
      minWidth: 140,
      cellRenderer: (params: ICellRendererParams<ItemCardVariantDto>) => {
        if (!params.data || !onAddInitialStock) {
          return <span className={styles.placeholder}>—</span>;
        }
        return (
          <StockCellLink
            ready={addInitialStockEndpointReady}
            onClick={() => onAddInitialStock(params.data!)}
          />
        );
      },
    });

    // Add initial stock + delete actions, manually rendered since we set
    // enableDelete=false on the foundation (its built-in delete doesn't go
    // through the API + confirm dialog).
    if (onAddInitialStock) {
      cols.push({
        colId: "addStock",
        headerName: "",
        width: 44,
        minWidth: 44,
        maxWidth: 44,
        resizable: false,
        cellRenderer: (params: ICellRendererParams<ItemCardVariantDto>) => {
          if (!params.data) return null;
          return (
            <AddInitialStockButton
              ready={addInitialStockEndpointReady}
              onClick={() => onAddInitialStock(params.data!)}
            />
          );
        },
      });
    }
    cols.push({
      colId: "delete",
      headerName: "",
      width: 44,
      minWidth: 44,
      maxWidth: 44,
      resizable: false,
      cellRenderer: (params: ICellRendererParams<ItemCardVariantDto>) => {
        if (!params.data) return null;
        return (
          <button
            type="button"
            className={cn(styles.iButton, styles.iButtonDanger)}
            aria-label={`Delete variant ${params.data.displayName}`}
            onClick={() => setConfirmDeleteVariant(params.data!)}
            disabled={deleteMutation.isPending}
          >
            <HugeiconsIcon icon={Delete02Icon} size={14} />
          </button>
        );
      },
    });

    return cols;
  })();

  if (visibleVariants.length === 0) {
    return (
      <p className="text-[length:var(--text-sm)] text-muted-foreground py-(--space-4)">
        No variants yet. Open configuration to add some.
      </p>
    );
  }

  return (
    <>
      <EditableLineDataGrid<ItemCardVariantDto>
        rows={rows}
        columns={columns}
        getRowId={(row) => row.id}
        createRow={() => ({ ...visibleVariants[0]! })}
        onRowsChange={handleRowsChange}
        addLabel=""
        enableAddRow={false}
        enableReorder={false}
        enableDelete={false}
        // Match Calm Matrix design: 30px header, 34px body row.
        headerHeight={30}
        rowHeight={34}
        rowHasError={(row) => row.duplicateCombinationWarnings.length > 0}
      />

      <AlertDialog
        open={confirmDeleteVariant != null}
        onOpenChange={(open) => {
          if (!open) setConfirmDeleteVariant(null);
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete variant?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDeleteVariant?.displayName} will be removed from this card.
              {deleteMutation.error ? (
                <span className="block mt-(--space-2) text-destructive">
                  {(deleteMutation.error as Error).message}
                </span>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => deleteMutation.reset()}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                if (!confirmDeleteVariant) return;
                deleteMutation.mutate(confirmDeleteVariant.id, {
                  onSuccess: () => setConfirmDeleteVariant(null),
                });
              }}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function AddInitialStockButton({
  ready,
  onClick,
}: {
  ready: boolean | undefined;
  onClick: () => void;
}) {
  if (!ready) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={styles.iButton}
            aria-label="Add initial stock"
            disabled
          >
            <HugeiconsIcon icon={Add01Icon} size={14} />
          </button>
        </TooltipTrigger>
        <TooltipContent>Pending backend.</TooltipContent>
      </Tooltip>
    );
  }
  return (
    <button
      type="button"
      className={styles.iButton}
      aria-label="Add initial stock"
      onClick={onClick}
      style={{ color: "var(--color-accent)" }}
    >
      <HugeiconsIcon icon={Add01Icon} size={14} />
    </button>
  );
}

function StockCellLink({
  ready,
  onClick,
}: {
  ready: boolean | undefined;
  onClick: () => void;
}) {
  if (!ready) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" className={styles.stockAdd} disabled>
            Add initial stock
          </button>
        </TooltipTrigger>
        <TooltipContent>Pending backend.</TooltipContent>
      </Tooltip>
    );
  }
  return (
    <button type="button" className={styles.stockAdd} onClick={onClick}>
      Add initial stock
    </button>
  );
}

