"use client";

import Link from "next/link";
import { useCallback, useMemo, useRef, useState } from "react";
import { itemDetailHref } from "@/lib/inventory/types";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ICellRendererParams, ValueSetterParams } from "ag-grid-community";
import type { z } from "zod";
import { CardPage, CardPageBody, CardSection } from "@/components/card-page/card-page";
import { CardPageHeader } from "@/components/card-page/card-page-header";
import type { CardSaveState } from "@/components/card-page/card-save-status";
import { CardField } from "@/components/card-page/card-field";
import {
  CardFormRow,
  ReadOnlyFieldValue,
} from "@/components/card-page/form-cell";
import {
  FramedTable,
  FramedTableCell,
  FramedTableHead,
  FramedTableHeaderCell,
  FramedTableRow,
  TableFrame,
} from "@/components/table-frame";
import { useConfirmMutation } from "@/components/card-page/use-confirm-mutation";
import { useDeleteEntity } from "@/components/card-page/use-delete-entity";
import { FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatQuantity, normalizeNumeric } from "@/lib/format";
import { ApiJsonError, apiJson } from "@/lib/client/api";
import { buildInventoryLedgerHref } from "@/lib/inventory/ledger";
import { defaultStocktakeCopyName } from "@/lib/stocktake-names";
import {
  type CloneStocktake,
  updateStocktakeCountsSchema,
} from "@/lib/schemas/stocktakes";
import { STOCKTAKE_COUNT_QTY_TOOLTIP } from "@/lib/tooltip-copy";
import { TooltipHeader } from "@/components/tooltip-header";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  EditableLineDataGrid,
  type ColDef,
  type EditableLineDataGridChange,
} from "@/components/editable-line-data-grid";
import { InventoryItemLineCellEditor } from "@/components/editable-lines";
import type { InventoryItemComboboxOption } from "@/components/inventory-item-combobox";
import { StocktakeStatusBadge } from "./status-badge";
import { CloneStocktakeReasonDialog } from "./clone-stocktake-reason-dialog";
import {
  formatScope,
  formatCloneSkippedItemsWarning,
  type StocktakeCompletionPreview,
  type CloneStocktakeResult,
  type StocktakePreviewItem,
  type StocktakeDetail as StocktakeDetailType,
} from "./types";
import styles from "@/components/card-page/card-page.module.css";
import { queryKeys } from "@/lib/client/query-keys";

type ApiError = {
  status?: number;
  error?: string;
  errors?: Record<string, string[]>;
};

type CountFilter = "all" | "counted" | "uncounted" | "variance";
type StocktakeGridRow = StocktakeDetailType["lines"][number] & { isNew?: boolean };
type StocktakeLotRow = StocktakeGridRow["lots"][number];
type StocktakeItemDisplayRow = StocktakeGridRow & { rowKind: "item" };
type StocktakeLotDisplayRow = Omit<StocktakeGridRow, "lots"> & {
  rowKind: "lot";
  parentLineId: string;
  lot: StocktakeLotRow;
  lots: [];
};
type StocktakeDisplayRow = StocktakeItemDisplayRow | StocktakeLotDisplayRow;
type StocktakeUpdatePayload = z.input<typeof updateStocktakeCountsSchema>;

function normalizeCountedQtyInput(value: string | null | undefined) {
  if (value == null) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function sumQuantities(values: Array<string | null | undefined>) {
  return normalizeNumeric(values.reduce((sum, value) => sum + Number(value ?? 0), 0));
}

function getCountedLots(lots: StocktakeLotRow[]) {
  return lots.filter((lot) => lot.countedQty != null);
}

function getLotBackedCountedQty(lots: StocktakeLotRow[]) {
  const countedLots = getCountedLots(lots);
  if (countedLots.length === 0) {
    return null;
  }

  return sumQuantities(countedLots.map((lot) => lot.countedQty));
}

function getLotBackedVarianceQty(lots: StocktakeLotRow[]) {
  const countedLots = getCountedLots(lots);
  if (countedLots.length === 0) {
    return null;
  }

  return sumQuantities(
    countedLots.map((lot) =>
      normalizeNumeric(Number(lot.countedQty) - Number(lot.expectedQty))
    )
  );
}

function isLotDisplayRow(row: StocktakeDisplayRow): row is StocktakeLotDisplayRow {
  return row.rowKind === "lot";
}

function asItemDisplayRow(row: StocktakeGridRow): StocktakeItemDisplayRow {
  return { ...row, rowKind: "item" };
}

function toApiError(error: unknown, fallback: string): ApiError {
  if (error instanceof ApiJsonError) {
    return {
      status: error.status,
      error: error.message,
      errors: error.errors,
    };
  }

  if (error instanceof Error) {
    return { error: error.message };
  }

  return { error: fallback };
}

export function StocktakeDetail({
  stocktake,
  previewItems,
  canViewLedger = false,
  lotTrackingLocked = false,
}: {
  stocktake: StocktakeDetailType;
  previewItems: StocktakePreviewItem[];
  canViewLedger?: boolean;
  lotTrackingLocked?: boolean;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);
  const [countFilter, setCountFilter] = useState<CountFilter>("all");
  const [lineSearch, setLineSearch] = useState("");
  const [rows, setRows] = useState<StocktakeGridRow[]>(stocktake.lines);
  const [stocktakeName, setStocktakeName] = useState(stocktake.name);
  const [reviewPreview, setReviewPreview] =
    useState<StocktakeCompletionPreview | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewConfirmStale, setReviewConfirmStale] = useState(false);
  const [stocktakeReason, setStocktakeReason] = useState(stocktake.reason ?? "");
  const [foundLotLineId, setFoundLotLineId] = useState<string | null>(null);
  const [foundLotNumber, setFoundLotNumber] = useState("");
  const [foundLotError, setFoundLotError] = useState<string | null>(null);
  const canEditCounts = stocktake.status === "draft";

  const refreshStocktakeQueries = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.stocktakes.root });
  };

  // A small sequential save queue: count edits PUT in order, a failed
  // payload stays at the head for the next flush. This is a fire-and-forget
  // batch queue, not a document draft — the card kernel does not apply here.
  const [saveStatus, setSaveStatus] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const saveQueueRef = useRef<StocktakeUpdatePayload[]>([]);
  const saveInFlightRef = useRef<Promise<void> | null>(null);
  const flushCounts = useCallback(() => {
    if (saveInFlightRef.current) {
      return saveInFlightRef.current;
    }
    if (saveQueueRef.current.length === 0) {
      return Promise.resolve();
    }
    saveInFlightRef.current = (async () => {
      setSaveStatus("saving");
      try {
        do {
          while (saveQueueRef.current.length > 0) {
            const payload = saveQueueRef.current[0];
            setActionError(null);
            try {
              await apiJson<void>(`/api/stocktakes/${stocktake.id}`, {
                method: "PUT",
                body: payload,
                fallbackError: "Failed to save counts.",
              });
            } catch (caught) {
              const error = toApiError(caught, "Failed to save counts.");
              setActionError(error.error ?? "Failed to save counts.");
              throw error;
            }
            saveQueueRef.current.shift();
          }
          await refreshStocktakeQueries();
        } while (saveQueueRef.current.length > 0);
        setSaveStatus("saved");
      } catch (error) {
        setSaveStatus("error");
        throw error;
      } finally {
        saveInFlightRef.current = null;
      }
    })();
    saveInFlightRef.current.catch(() => undefined);
    return saveInFlightRef.current;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stocktake.id]);

  const completeMutation = useMutation<
    void,
    ApiError,
    { confirmStale: boolean }
  >({
    mutationFn: async ({ confirmStale }) => {
      try {
        await apiJson<void>(`/api/stocktakes/${stocktake.id}/complete`, {
          method: "POST",
          body: { confirmStale },
          idempotencyKey: "stocktake-complete",
          fallbackError: "Failed to complete stocktake.",
        });
      } catch (error) {
        throw toApiError(error, "Failed to complete stocktake.");
      }
    },
    onMutate: () => {
      setActionError(null);
    },
    onSuccess: async () => {
      await Promise.all([
        refreshStocktakeQueries(),
        queryClient.invalidateQueries({ queryKey: queryKeys.items.root }),
      ]);
      router.refresh();
    },
    onError: (error: ApiError) => {
      setActionError(error.error ?? "Failed to complete stocktake.");
      if (error.status === 409) {
        void openCompletionReview(true);
      }
    },
  });

  const openCompletionReview = async (confirmStale = false) => {
    try {
      await flushCounts();
      const body = await apiJson<StocktakeCompletionPreview>(
        `/api/stocktakes/${stocktake.id}/completion-preview`,
        { fallbackError: "Failed to prepare completion review." }
      );
      setReviewPreview(body);
      setReviewConfirmStale(confirmStale);
      setReviewOpen(true);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Failed to prepare completion review.");
      return;
    }
  };

  const handleComplete = () => {
    void openCompletionReview(false);
  };

  const confirmCompletion = async () => {
    try {
      await completeMutation.mutateAsync({
        confirmStale: reviewConfirmStale,
      });
      setReviewOpen(false);
    } catch {
      return;
    }
  };

  const deleteMutation = useDeleteEntity({
    mutationKey: ["stocktake-action", stocktake.id, "delete"],
    mutationFn: () =>
      apiJson<void>("/api/stocktakes", {
        method: "DELETE",
        body: { ids: [stocktake.id] },
        fallbackError: "Failed to delete stocktake.",
      }),
    onMutate: () => {
      setActionError(null);
    },
    invalidateQueryKeys: [queryKeys.stocktakes.root],
    onDeleted: () => router.push("/inventory/stocktakes"),
    onError: (error) => {
      setActionError(error.message);
    },
  });
  const deleteConfirm = useConfirmMutation<void>({
    title: "Delete this stocktake?",
    description: (
      <>
        Draft stocktakes will be removed from normal views without changing inventory.
        Completed stocktakes cannot be deleted. This action cannot be undone.
      </>
    ),
    confirmLabel: "Delete Stocktake",
    pendingLabel: "Deleting...",
    cancelLabel: "Back",
    mutation: deleteMutation,
  });

  const [cloneDialogOpen, setCloneDialogOpen] = useState(false);
  const cloneMutation = useMutation<CloneStocktakeResult, ApiError, CloneStocktake>({
    mutationFn: async (input: CloneStocktake) => {
      try {
        return await apiJson<CloneStocktakeResult>(
          `/api/stocktakes/${stocktake.id}/clone`,
          {
            method: "POST",
            body: input,
            idempotencyKey: "stocktake-clone",
            fallbackError: "Failed to copy stocktake.",
          }
        );
      } catch (error) {
        throw toApiError(error, "Failed to copy stocktake.");
      }
    },
    onSuccess: async (created) => {
      setCloneDialogOpen(false);
      await refreshStocktakeQueries();
      const warning = formatCloneSkippedItemsWarning(created);
      if (warning) window.alert(warning);
      router.push(`/inventory/stocktakes/${created.id}`);
    },
    onError: (error) => setActionError(error.error ?? "Failed to copy stocktake."),
  });

  const previewItemMap = useMemo(
    () => new Map(previewItems.map((item) => [item.id, item])),
    [previewItems]
  );

  const itemOptions = useMemo<InventoryItemComboboxOption[]>(
    () =>
      previewItems.map((item) => ({
        id: item.id,
        name: item.name,
        displayName: item.displayName,
        searchText: item.searchText,
        sku: item.sku,
        itemType: item.itemType,
        unitName: item.unitName,
      })),
    [previewItems]
  );

  const commitStocktakePatch = useCallback(
    (payload: StocktakeUpdatePayload) => {
      if (!canEditCounts) return;
      saveQueueRef.current.push(updateStocktakeCountsSchema.parse(payload));
      void flushCounts();
    },
    [canEditCounts, flushCounts]
  );

  const commitItemIds = useCallback(
    (nextRows: StocktakeGridRow[]) => {
      commitStocktakePatch({
        itemIds: nextRows
          .map((row) => row.itemId)
          .filter((itemId) => itemId.trim() !== ""),
      });
    },
    [commitStocktakePatch]
  );

  const displayLines = useMemo(() => {
    return rows.map((line) => {
      const currentCountedQty =
        line.lots.length > 0
          ? getLotBackedCountedQty(line.lots)
          : normalizeCountedQtyInput(line.countedQty);
      const currentVarianceQty =
        line.lots.length > 0
          ? getLotBackedVarianceQty(line.lots)
          : currentCountedQty == null
          ? null
          : normalizeNumeric(Number(currentCountedQty) - parseFloat(line.expectedQty));

      return {
        ...line,
        countedQty: currentCountedQty,
        varianceQty: currentVarianceQty,
        currentCountedQty,
        currentVarianceQty,
      };
    });
  }, [rows]);

  const filteredLines = useMemo(
    () =>
      displayLines.filter((line) => {
        const search = lineSearch.trim().toLowerCase();
        if (search) {
          const haystack = [
            line.itemName,
            line.itemSku,
            line.itemType,
            line.unitName,
          ]
            .filter((part): part is string => part != null && part !== "")
            .join(" ")
            .toLowerCase();

          if (!haystack.includes(search)) {
            return false;
          }
        }

        if (countFilter === "counted") {
          return line.currentCountedQty != null;
        }

        if (countFilter === "uncounted") {
          return line.currentCountedQty == null;
        }

        if (countFilter === "variance") {
          return (
            line.currentVarianceQty != null && parseFloat(line.currentVarianceQty) !== 0
          );
        }

        return true;
      }),
    [countFilter, displayLines, lineSearch]
  );

  const liveCountedCount = displayLines.filter(
    (line) => line.currentCountedQty != null
  ).length;
  const displayRows = useMemo<StocktakeDisplayRow[]>(
    () =>
      filteredLines.flatMap((line) => {
        const itemRow = asItemDisplayRow(line);
        if (line.lots.length === 0) {
          return [itemRow];
        }

        return [
          itemRow,
          ...line.lots.map((lot): StocktakeLotDisplayRow => ({
            ...line,
            rowKind: "lot",
            id: lot.id,
            parentLineId: line.id,
            lot,
            lots: [],
            expectedQty: lot.expectedQty,
            countedQty: lot.countedQty,
            varianceQty: lot.varianceQty,
            appliedDeltaQty: lot.appliedDeltaQty,
            notes: lot.notes,
            createdAt: lot.createdAt,
            updatedAt: lot.updatedAt,
          })),
        ];
      }),
    [filteredLines]
  );
  const canComplete =
    canEditCounts &&
    liveCountedCount > 0 &&
    stocktakeReason.trim() !== "" &&
    !completeMutation.isPending;
  const cardSaveState = cardSaveStateFromEngine(saveStatus);
  const openFoundLotDrawer = useCallback((lineId: string) => {
    setFoundLotLineId(lineId);
    setFoundLotNumber("");
    setFoundLotError(null);
  }, []);

  const closeFoundLotDrawer = useCallback(() => {
    setFoundLotLineId(null);
    setFoundLotNumber("");
    setFoundLotError(null);
  }, []);

  const confirmFoundLot = useCallback(() => {
    if (!foundLotLineId) return;
    const lotNumber = foundLotNumber.trim();
    if (!lotNumber) {
      setFoundLotError("Lot name is required.");
      return;
    }

    let duplicate = false;
    setRows((currentRows) =>
      currentRows.map((line) => {
        if (line.id !== foundLotLineId) return line;
        if (line.lots.some((lot) => lot.lotNumber.trim() === lotNumber)) {
          duplicate = true;
          return line;
        }
        const now = new Date();
        return {
          ...line,
          lots: [
            ...line.lots,
            {
              id: `found-${crypto.randomUUID()}`,
              lotId: null,
              isFound: true,
              lotNumber,
              expectedQty: "0",
              countedQty: null,
              varianceQty: null,
              appliedDeltaQty: null,
              notes: null,
              receivedAt: now,
              sortOrder: line.lots.length,
              createdAt: now,
              updatedAt: now,
            },
          ],
        };
      })
    );

    if (duplicate) {
      setFoundLotError("This lot is already listed.");
      return;
    }
    closeFoundLotDrawer();
  }, [closeFoundLotDrawer, foundLotLineId, foundLotNumber]);

  const countActions = (
    <div className="flex flex-wrap items-center gap-(--space-3)">
      <Input
        placeholder="Search..."
        aria-label="Search stocktake items"
        value={lineSearch}
        onChange={(event) => setLineSearch(event.target.value)}
        className="w-72 max-w-sm"
      />
      <ToggleGroup
        type="single"
        value={countFilter}
        onValueChange={(value) => {
          if (value) {
            setCountFilter(value as CountFilter);
          }
        }}
        variant="outline"
        size="sm"
      >
        <ToggleGroupItem value="all">All</ToggleGroupItem>
        <ToggleGroupItem value="counted">Counted</ToggleGroupItem>
        <ToggleGroupItem value="uncounted">Uncounted</ToggleGroupItem>
        <ToggleGroupItem value="variance">Variance Only</ToggleGroupItem>
      </ToggleGroup>
    </div>
  );
  const columns = useMemo<ColDef<StocktakeDisplayRow>[]>(() => {
    const baseColumns: ColDef<StocktakeDisplayRow>[] = [
      {
        field: "itemId",
        headerName: "Item",
        minWidth: 220,
        flex: 1.5,
        editable: (params) =>
          canEditCounts && (params.data ? !isLotDisplayRow(params.data) : false),
        cellEditor: InventoryItemLineCellEditor,
        cellEditorParams: {
          options: itemOptions,
          placeholder: "Search items...",
          emptyMessage: "No items found.",
          requiredMessage: "Select an item.",
          isRowBlank: (row: StocktakeDisplayRow) =>
            isLotDisplayRow(row) ? true : !row.itemId,
          showTypeBadge: true,
          getSecondaryText: (option: InventoryItemComboboxOption) =>
            option.sku ?? null,
        },
        valueFormatter: ({ value }) =>
          previewItemMap.get(String(value))?.displayName ?? "",
        valueSetter: (params: ValueSetterParams<StocktakeDisplayRow, string>) => {
          if (isLotDisplayRow(params.data)) return false;
          const item = previewItemMap.get(params.newValue ?? "");
          if (!item) return false;
          params.data.itemId = item.id;
          params.data.itemName = item.name;
          params.data.itemSku = item.sku;
          params.data.itemType = item.itemType;
          params.data.lotTrackingMode = item.lotTrackingMode;
          params.data.category = item.category;
          params.data.unitName = item.unitName;
          params.data.expectedQty = item.currentQty;
          params.data.countedQty = null;
          params.data.varianceQty = null;
          params.data.lots = [];
          return true;
        },
        cellRenderer: ({ data }: ICellRendererParams<StocktakeDisplayRow>) => {
          if (!data?.itemId) {
            return <span className="text-[var(--color-ink-faint)]">Select item</span>;
          }

          return (
            <Link
              href={itemDetailHref(data.itemType, data.itemId)}
              className="block min-w-0 hover:underline"
            >
              <span className="block truncate">{data.itemName}</span>
              {data.itemSku ? (
                <span className="block truncate text-xs text-[var(--color-ink-faint)]">
                  {data.itemSku}
                </span>
              ) : null}
            </Link>
          );
        },
      },
      {
        field: "category",
        headerName: "Category",
        minWidth: 150,
        flex: 0.6,
        valueFormatter: ({ value }) => value ?? "",
      },
      {
        colId: "lot",
        headerName: "Lot",
        minWidth: 150,
        flex: 0.55,
        cellClass: ({ data }) => data && !isLotDisplayRow(data) ? "text-[var(--color-ink-faint)]" : "",
        valueGetter: ({ data }) => data && isLotDisplayRow(data) ? data.lot.lotNumber : "",
        cellRenderer: ({ data }: ICellRendererParams<StocktakeDisplayRow>) => {
          if (!data) return null;
          if (isLotDisplayRow(data)) {
            return (
              <span className="font-mono">
                {data.lot.isFound ? "Found · " : ""}
                {data.lot.lotNumber}
              </span>
            );
          }
          if (!canEditCounts || data.lotTrackingMode !== "tracked" || lotTrackingLocked) {
            return <span className="text-muted-foreground">—</span>;
          }
          return (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => openFoundLotDrawer(data.id)}
            >
              Found lot
            </Button>
          );
        },
      },
      {
        field: "notes",
        headerName: "Notes",
        minWidth: 190,
        flex: 0.8,
        editable: (params) =>
          canEditCounts &&
          Boolean(params.data) &&
          (isLotDisplayRow(params.data!) || params.data!.lots.length === 0),
        cellEditor: "agTextCellEditor",
        valueGetter: ({ data }) => {
          if (!data) return "";
          return isLotDisplayRow(data) ? data.lot.notes ?? "" : data.notes ?? "";
        },
        valueSetter: (params: ValueSetterParams<StocktakeDisplayRow, string | null>) => {
          const notes = params.newValue?.trim() || null;
          if (isLotDisplayRow(params.data)) {
            params.data.lot.notes = notes;
          } else {
            params.data.notes = notes;
          }
          return true;
        },
      },
      {
        field: "countedQty",
        headerName: "Counted quantity",
        headerComponent: () => (
          <TooltipHeader label="Counted quantity" tooltip={STOCKTAKE_COUNT_QTY_TOOLTIP} />
        ),
        minWidth: 140,
        flex: 0.55,
        editable: (params) =>
          canEditCounts &&
          (params.data
            ? isLotDisplayRow(params.data) ||
              (params.data.lots.length === 0 &&
                (!lotTrackingLocked || params.data.lotTrackingMode !== "tracked"))
            : false),
        cellEditor: "agTextCellEditor",
        cellClass: "text-right",
        valueSetter: (params: ValueSetterParams<StocktakeDisplayRow, string | null>) => {
          params.data.countedQty = normalizeCountedQtyInput(params.newValue);
          return true;
        },
        valueGetter: ({ data }) => {
          if (!data) return null;
          if (isLotDisplayRow(data)) return data.countedQty;
          return data.lots.length ? getLotBackedCountedQty(data.lots) : data.countedQty;
        },
        valueFormatter: ({ value }) => (value == null ? "" : formatQuantity(value)),
      },
    ];
    if (canEditCounts) return baseColumns;
    return [
      ...baseColumns.slice(0, 4),
      {
        field: "expectedQty",
        headerName: "Expected",
        minWidth: 120,
        flex: 0.45,
        cellClass: "text-right",
        valueFormatter: ({ value }) => formatQuantity(value),
      },
      ...baseColumns.slice(4),
      {
        colId: "variance",
        headerName: "Variance",
        minWidth: 120,
        flex: 0.45,
        cellClass: "text-right",
        valueGetter: ({ data }) => {
          if (!data) return null;
          if (isLotDisplayRow(data)) return data.varianceQty;
          if (data.lots.length > 0) return getLotBackedVarianceQty(data.lots);
          return data.varianceQty;
        },
        valueFormatter: ({ value }) => (value == null ? "" : formatQuantity(value)),
      },
    ];
  }, [canEditCounts, itemOptions, lotTrackingLocked, openFoundLotDrawer, previewItemMap]);

  const createBlankRow = useCallback((): StocktakeDisplayRow => {
    const now = new Date();
    return {
      id: `new-${crypto.randomUUID()}`,
      rowKind: "item",
      isNew: true,
      itemId: "",
      itemName: "",
      itemSku: null,
      itemType: "material",
      lotTrackingMode: "tracked",
      category: null,
      unitName: "",
      expectedQty: "0",
      countedQty: null,
      varianceQty: null,
      appliedDeltaQty: null,
      notes: null,
      sortOrder: rows.length,
      lots: [],
      createdAt: now,
      updatedAt: now,
    };
  }, [rows.length]);

  const handleLotCountChange = useCallback(
    (lineId: string, lotLineId: string, value: string | null, commit = false) => {
      const countedQty = normalizeCountedQtyInput(value);
      const committedLot =
        rows
          .find((line) => line.id === lineId)
          ?.lots.find((lot) => lot.id === lotLineId) ?? null;
      setRows((currentRows) =>
        currentRows.map((line) => {
          if (line.id !== lineId) {
            return line;
          }

          const lots = line.lots.map((lot) =>
            lot.id === lotLineId
              ? {
                  ...lot,
                  countedQty,
                  varianceQty:
                    countedQty == null
                      ? null
                      : normalizeNumeric(Number(countedQty) - Number(lot.expectedQty)),
                }
              : lot
          );

          return {
            ...line,
            lots,
            countedQty: getLotBackedCountedQty(lots),
            varianceQty: getLotBackedVarianceQty(lots),
          };
        })
      );

      if (commit) {
        if (committedLot?.isFound) {
          if (countedQty == null) return;
          commitStocktakePatch({
            lotLines: [
              {
                isFound: true,
                stocktakeItemId: lineId,
                lotNumber: committedLot.lotNumber,
                countedQty,
              },
            ],
          });
          return;
        }

        commitStocktakePatch({
          lotLines: [
            {
              lotLineId,
              countedQty,
            },
          ],
        });
      }
    },
    [commitStocktakePatch, rows]
  );

  const handleRowsChange = useCallback(
    (
      nextRows: StocktakeDisplayRow[],
      change: EditableLineDataGridChange<StocktakeDisplayRow>
    ) => {
      const nextItemRows = nextRows.filter(
        (row): row is StocktakeItemDisplayRow => !isLotDisplayRow(row)
      );
      const visibleIds = new Set(filteredLines.map((line) => line.id));
      const mergedRows =
        filteredLines.length === rows.length
          ? nextItemRows
          : [
              ...rows.filter((row) => !visibleIds.has(row.id)),
              ...nextItemRows,
            ];
      setRows(mergedRows);

      if (
        change.type === "row_deleted" ||
        change.type === "row_reordered" ||
        (change.field === "itemId" &&
          change.row &&
          !isLotDisplayRow(change.row) &&
          change.row.itemId)
      ) {
        commitItemIds(mergedRows);
        return;
      }

      if (
        change.field === "countedQty" &&
        change.row &&
        !change.row.isNew &&
        (isLotDisplayRow(change.row) || change.row.lots.length === 0)
      ) {
        if (isLotDisplayRow(change.row)) {
          handleLotCountChange(
            change.row.parentLineId,
            change.row.lot.id,
            change.row.countedQty,
            true
          );
          return;
        }

        commitStocktakePatch({
          lines: [
            {
              lineId: change.row.id,
              countedQty: normalizeCountedQtyInput(change.row.countedQty),
            },
          ],
        });
      }

      if (
        change.field === "notes" &&
        change.row &&
        !change.row.isNew &&
        (isLotDisplayRow(change.row) || change.row.lots.length === 0)
      ) {
        if (isLotDisplayRow(change.row)) {
          commitStocktakePatch({
            lotLines: [
              {
                lotLineId: change.row.lot.id,
                countedQty: normalizeCountedQtyInput(change.row.lot.countedQty),
                notes: change.row.lot.notes ?? null,
              },
            ],
          });
          return;
        }

        commitStocktakePatch({
          lines: [
            {
              lineId: change.row.id,
              countedQty: normalizeCountedQtyInput(change.row.countedQty),
              notes: change.row.notes ?? null,
            },
          ],
        });
      }
    },
    [commitItemIds, commitStocktakePatch, filteredLines, handleLotCountChange, rows]
  );

  return (
    <>
      <CardPage>
        <CardPageHeader
          title={stocktakeName}
          statusBadge={<StocktakeStatusBadge status={stocktake.status} />}
          saveState={cardSaveState}
          showPrint={false}
          primaryAction={
            canEditCounts
              ? {
                  label: completeMutation.isPending ? "Completing..." : "Complete",
                  onClick: handleComplete,
                  disabled: !canComplete,
                }
              : undefined
          }
          menuActions={[
                ...(canViewLedger
                  ? [
                      {
                        label: "View inventory activity",
                        onClick: () =>
                          router.push(
                            buildInventoryLedgerHref({
                              documentType: "stocktake",
                              documentId: stocktake.id,
                            })
                        ),
                      },
                    ]
                  : []),
                {
                  label: cloneMutation.isPending ? "Copying..." : "Copy stocktake",
                  onClick: () => setCloneDialogOpen(true),
                  disabled: cloneMutation.isPending,
                },
                {
                  label:
                    stocktake.status === "completed"
                      ? "Print reconciliation report"
                      : "Print blind count sheet",
                  href:
                    stocktake.status === "completed"
                      ? `/api/stocktakes/${stocktake.id}/pdf?template=reconciliation-report&disposition=inline`
                      : `/api/stocktakes/${stocktake.id}/pdf?template=count-sheet&disposition=inline`,
                  target: "_blank" as const,
                },
                {
                  label:
                    stocktake.status === "completed"
                      ? "Download reconciliation PDF"
                      : "Download count sheet PDF",
                  href:
                    stocktake.status === "completed"
                      ? `/api/stocktakes/${stocktake.id}/pdf?template=reconciliation-report&disposition=attachment`
                      : `/api/stocktakes/${stocktake.id}/pdf?template=count-sheet&disposition=attachment`,
                },
                ...(canEditCounts
                  ? [
                      {
                        label: "Delete stocktake",
                        onClick: () => deleteConfirm.trigger(undefined),
                        disabled: deleteMutation.isPending,
                        destructive: true,
                      },
                    ]
                  : []),
              ]}
          fallbackHref="/inventory/stocktakes"
        />

        <CardPageBody>
          <CardSection title="Stocktake at a glance">
            <CardFormRow columns="three">
              <CardField label="Name" required>
                <Input
                  aria-label="Name"
                  className={styles.underlineControl}
                  value={stocktakeName}
                  disabled={!canEditCounts}
                  onChange={(event) => setStocktakeName(event.target.value)}
                  onBlur={(event) => {
                    const name = event.currentTarget.value.trim();
                    if (!name) {
                      setStocktakeName(stocktake.name);
                      return;
                    }
                    if (name !== stocktake.name) commitStocktakePatch({ name });
                  }}
                />
              </CardField>
              <CardField label="Created from">
                <ReadOnlyFieldValue>{formatScope(stocktake.scope)}</ReadOnlyFieldValue>
              </CardField>
              <CardField label="Lines">
                <ReadOnlyFieldValue>{rows.length}</ReadOnlyFieldValue>
              </CardField>
            </CardFormRow>
            <CardFormRow>
              <CardField label="Reason">
                <Input
                  aria-label="Reason"
                  className={styles.underlineControl}
                  placeholder="Why is this count being made?"
                  value={stocktakeReason}
                  disabled={!canEditCounts}
                  onChange={(event) => setStocktakeReason(event.target.value)}
                  onBlur={(event) => {
                    const reason = event.currentTarget.value.trim();
                    if (reason !== (stocktake.reason ?? "")) {
                      commitStocktakePatch({ reason: reason || null });
                    }
                  }}
                />
              </CardField>
            </CardFormRow>
          </CardSection>

          {actionError ? (
            <CardSection aria-label="Stocktake errors">
              {actionError ? <FieldError>{actionError}</FieldError> : null}
            </CardSection>
          ) : null}

          {canEditCounts && liveCountedCount === 0 ? (
            <CardSection aria-label="Stocktake completion guidance">
              <p className="text-[length:var(--text-sm)] text-[var(--color-ink-faint)]">
                Enter at least one available count before completing this stocktake.
              </p>
            </CardSection>
          ) : null}

          <CardSection
            title="Available counts"
            hint="Count available stock only. Blocked and rejected stock stay managed from lot disposition actions."
            actions={countActions}
          >
            <EditableLineDataGrid
              rows={displayRows}
              columns={columns}
              getRowId={(row) => row.id}
              createRow={createBlankRow}
              onRowsChange={handleRowsChange}
              addLabel="Add item"
              emptyMessage="No lines match this filter."
              enableAddRow={canEditCounts}
              enableDelete={canEditCounts}
              enableReorder={false}
              initializeBlankRow={false}
              isBlankRow={(row) => row.itemId === ""}
              canDeleteRow={(row) => !isLotDisplayRow(row)}
              getDeleteDisabledReason={(row) =>
                isLotDisplayRow(row) ? "Delete the item row to remove its lots." : null
              }
            />
          </CardSection>
        </CardPageBody>
      </CardPage>

      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent size="2xl">
          <DialogHeader>
            <DialogTitle>Review stocktake</DialogTitle>
          </DialogHeader>
          <TableFrame className="max-h-[60vh] overflow-auto">
            <FramedTable>
              <FramedTableHead>
                <tr>
                  <FramedTableHeaderCell>Item</FramedTableHeaderCell>
                  <FramedTableHeaderCell>Lot</FramedTableHeaderCell>
                  <FramedTableHeaderCell align="right">Current</FramedTableHeaderCell>
                  <FramedTableHeaderCell align="right">Counted</FramedTableHeaderCell>
                  <FramedTableHeaderCell align="right">Variance</FramedTableHeaderCell>
                </tr>
              </FramedTableHead>
              <tbody>
                {reviewPreview?.lines.flatMap((line) =>
                  line.lots.length
                    ? line.lots.map((lot) => (
                        <FramedTableRow key={lot.lotLineId}>
                          <FramedTableCell>{line.itemName}</FramedTableCell>
                          <FramedTableCell className="font-mono">{lot.lotNumber}</FramedTableCell>
                          <FramedTableCell align="right">{formatQuantity(lot.currentQty)} {line.unitName}</FramedTableCell>
                          <FramedTableCell align="right">{formatQuantity(lot.countedQty)} {line.unitName}</FramedTableCell>
                          <FramedTableCell align="right">{formatQuantity(lot.varianceQty)} {line.unitName}</FramedTableCell>
                        </FramedTableRow>
                      ))
                    : [
                        <FramedTableRow key={line.lineId}>
                          <FramedTableCell>{line.itemName}</FramedTableCell>
                          <FramedTableCell />
                          <FramedTableCell align="right">{formatQuantity(line.currentQty)} {line.unitName}</FramedTableCell>
                          <FramedTableCell align="right">{formatQuantity(line.countedQty)} {line.unitName}</FramedTableCell>
                          <FramedTableCell align="right">{formatQuantity(line.varianceQty)} {line.unitName}</FramedTableCell>
                        </FramedTableRow>,
                      ]
                )}
              </tbody>
            </FramedTable>
          </TableFrame>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewOpen(false)}>
              Back
            </Button>
            <Button
              onClick={confirmCompletion}
              disabled={completeMutation.isPending}
            >
              {completeMutation.isPending ? "Completing..." : "Complete stocktake"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <CloneStocktakeReasonDialog
        key={cloneDialogOpen ? defaultStocktakeCopyName(stocktake.name) : "closed"}
        open={cloneDialogOpen}
        pending={cloneMutation.isPending}
        defaultName={defaultStocktakeCopyName(stocktake.name)}
        onOpenChange={setCloneDialogOpen}
        onSubmit={(input) => cloneMutation.mutate(input)}
      />
      <Sheet
        open={foundLotLineId != null}
        onOpenChange={(open) => {
          if (!open) closeFoundLotDrawer();
        }}
      >
        <SheetContent side="bottom" className="mx-auto max-w-md">
          <SheetHeader>
            <SheetTitle>Found lot</SheetTitle>
          </SheetHeader>
          <div className="px-(--space-8)">
            <Input
              autoFocus
              value={foundLotNumber}
              onChange={(event) => {
                setFoundLotNumber(event.target.value);
                setFoundLotError(null);
              }}
              aria-label="Found lot name"
              placeholder="Lot name"
            />
            {foundLotError ? (
              <FieldError className="mt-(--space-2)">{foundLotError}</FieldError>
            ) : null}
          </div>
          <SheetFooter>
            <Button variant="outline" onClick={closeFoundLotDrawer}>
              Back
            </Button>
            <Button onClick={confirmFoundLot}>Confirm</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {deleteConfirm.dialog}
    </>
  );
}

function cardSaveStateFromEngine(state: "idle" | "saving" | "saved" | "error"): CardSaveState {
  if (state === "saving") return "saving";
  if (state === "error") return "failed";
  return "saved";
}
