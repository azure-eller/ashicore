"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { itemDetailHref } from "@/app/(dashboard)/inventory/types";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ICellRendererParams, ValueSetterParams } from "ag-grid-community";
import type { z } from "zod";
import { createIdempotencyHeaders } from "@/lib/api/idempotency-client";
import { Badge } from "@/components/ui/badge";
import { CardPage, CardPageBody, CardSection } from "@/components/card-page/card-page";
import { CardPageHeader } from "@/components/card-page/card-page-header";
import type { CardSaveState } from "@/components/card-page/card-save-status";
import { CellShell } from "@/components/card-page/form-cell";
import { useConfirmMutation } from "@/components/card-page/use-confirm-mutation";
import { useDeleteEntity } from "@/components/card-page/use-delete-entity";
import { FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  formatDateTime,
  formatQuantity,
  normalizeNumeric,
} from "@/lib/format";
import { useOrganizationTimeZone } from "@/components/time-zone-provider";
import { buildInventoryLedgerHref } from "@/lib/inventory/ledger";
import {
  updateStocktakeCountsSchema,
  type StocktakeScope,
  parseStocktakeScope,
} from "@/lib/schemas/stocktakes";
import {
  ITEM_TYPE_TOOLTIP,
  STOCKTAKE_COUNT_QTY_TOOLTIP,
  STOCKTAKE_CURRENT_QTY_TOOLTIP,
  STOCKTAKE_LINE_VARIANCE_TOOLTIP,
  UNIT_TOOLTIP,
} from "@/lib/tooltip-copy";
import { TooltipHeader } from "@/components/tooltip-header";
import {
  EditableLineDataGrid,
  type ColDef,
  type EditableLineDataGridChange,
} from "@/components/editable-line-data-grid";
import { useDraftSaveEngine } from "@/lib/hooks/use-draft-save-engine";
import { StocktakeStatusBadge } from "./status-badge";
import {
  buildStocktakeName,
  formatScope,
  type StocktakePreviewItem,
  type StocktakeDetail as StocktakeDetailType,
  type StocktakeScopeOptionGroup,
} from "./types";
import styles from "@/components/card-page/card-page.module.css";

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

export function StocktakeDetail({
  stocktake,
  scopeGroups,
  previewItems,
  canViewLedger = false,
}: {
  stocktake: StocktakeDetailType;
  scopeGroups: StocktakeScopeOptionGroup[];
  previewItems: StocktakePreviewItem[];
  canViewLedger?: boolean;
}) {
  const timeZone = useOrganizationTimeZone();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);
  const [countFilter, setCountFilter] = useState<CountFilter>("all");
  const [lineSearch, setLineSearch] = useState("");
  const [rows, setRows] = useState<StocktakeGridRow[]>(stocktake.lines);
  const [stocktakeName, setStocktakeName] = useState(stocktake.name);
  const [stocktakeScope, setStocktakeScope] = useState<StocktakeScope>(stocktake.scope);
  const [stocktakeNotes, setStocktakeNotes] = useState(stocktake.notes ?? "");
  const canEditCounts = stocktake.status === "draft";

  const refreshStocktakeQueries = async () => {
    await queryClient.invalidateQueries({ queryKey: ["stocktakes"] });
  };

  const saveEngine = useDraftSaveEngine<
    StocktakeUpdatePayload,
    StocktakeUpdatePayload,
    void
  >({
    initialDraft: {},
    initialId: stocktake.id,
    isSaveable: () => canEditCounts,
    applyOp: (draft, op) => mergeStocktakeUpdatePayload(draft, op),
    create: async () => undefined,
    save: async (_id, _draft, ops) => {
      for (const { op } of ops) {
        setActionError(null);
        const response = await fetch(`/api/stocktakes/${stocktake.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updateStocktakeCountsSchema.parse(op)),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          const error = {
            error: body?.error ?? "Failed to save counts.",
            errors: body?.errors,
          } satisfies ApiError;
          setActionError(error.error);
          throw error;
        }
      }
      await refreshStocktakeQueries();
      return undefined;
    },
    getResultId: () => stocktake.id,
    applyPersistedIdentity: (draft) => draft,
    mergeServerOwnedFields: (draft) => draft,
    getErrorMessage: (error) =>
      (error as ApiError)?.error ??
      (error instanceof Error ? error.message : "Failed to save counts."),
  });

  const completeMutation = useMutation<void, ApiError, boolean>({
    mutationFn: async (confirmStale = false) => {
      const response = await fetch(`/api/stocktakes/${stocktake.id}/complete`, {
        method: "POST",
        headers: createIdempotencyHeaders("stocktake-complete", {
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({ confirmStale }),
      });
      const body = await response.json().catch(() => null);

      if (!response.ok) {
        throw {
          status: response.status,
          error: body?.error ?? "Failed to complete stocktake.",
        } satisfies ApiError;
      }
    },
    onMutate: () => {
      setActionError(null);
    },
    onSuccess: async () => {
      await Promise.all([
        refreshStocktakeQueries(),
        queryClient.invalidateQueries({ queryKey: ["items"] }),
      ]);
      router.refresh();
    },
    onError: (error: ApiError) => {
      setActionError(error.error ?? "Failed to complete stocktake.");
    },
  });

  const handleComplete = async () => {
    try {
      await completeMutation.mutateAsync(false);
    } catch {
      return;
    }
  };

  const deleteMutation = useDeleteEntity({
    mutationKey: ["stocktake-action", stocktake.id, "delete"],
    mutationFn: async () => {
      const response = await fetch("/api/stocktakes", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [stocktake.id] }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to delete stocktake.");
      }
    },
    onMutate: () => {
      setActionError(null);
    },
    invalidateQueryKeys: [["stocktakes"]],
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

  const previewItemMap = useMemo(
    () => new Map(previewItems.map((item) => [item.id, item])),
    [previewItems]
  );

  const commitStocktakePatch = useCallback(
    (payload: StocktakeUpdatePayload) => {
      if (!canEditCounts) return;
      saveEngine.applyLocalOp(updateStocktakeCountsSchema.parse(payload), 0);
    },
    [canEditCounts, saveEngine]
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
    !completeMutation.isPending &&
    saveEngine.status !== "saving";
  const cardSaveState = cardSaveStateFromEngine(saveEngine.status);
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
    const selectableItemIds = previewItems.map((item) => item.id);
    return [
      {
        field: "itemId",
        headerName: "Item",
        minWidth: 220,
        flex: 1.5,
        editable: (params) =>
          canEditCounts && (params.data ? !isLotDisplayRow(params.data) : false),
        cellEditor: "agSelectCellEditor",
        cellEditorParams: {
          values: selectableItemIds,
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
          params.data.unitName = item.unitName;
          params.data.expectedQty = item.currentQty;
          params.data.countedQty = null;
          params.data.varianceQty = null;
          params.data.lots = [];
          return true;
        },
        cellRenderer: ({ data }: ICellRendererParams<StocktakeDisplayRow>) => {
          if (!data?.itemId) {
            return <span className="text-muted-foreground">Select item</span>;
          }

          if (isLotDisplayRow(data)) {
            return (
              <div className="flex min-w-0 items-center gap-(--space-3) pl-(--space-6)">
                <span className="font-mono text-[length:var(--text-sm)]">
                  {data.lot.lotNumber}
                </span>
                <span className="truncate text-[length:var(--text-xs)] text-muted-foreground">
                  {formatDateTime(data.lot.receivedAt, timeZone)}
                </span>
              </div>
            );
          }

          return (
            <Link
              href={itemDetailHref(data.itemType, data.itemId)}
              className="block min-w-0 hover:underline"
            >
              <span className="block truncate">{data.itemName}</span>
              {data.itemSku ? (
                <span className="block truncate text-xs text-muted-foreground">
                  {data.itemSku}
                </span>
              ) : null}
            </Link>
          );
        },
      },
      {
        field: "itemType",
        headerName: "Type",
        headerComponent: () => <TooltipHeader label="Type" tooltip={ITEM_TYPE_TOOLTIP} />,
        minWidth: 100,
        flex: 0.45,
        cellRenderer: ({ data, value }: ICellRendererParams<StocktakeDisplayRow>) =>
          data && isLotDisplayRow(data) ? (
            <span className="text-muted-foreground">Lot</span>
          ) : value ? (
            <Badge variant="outline">{value}</Badge>
          ) : null,
      },
      {
        field: "unitName",
        headerName: "Unit",
        headerComponent: () => <TooltipHeader label="Unit" tooltip={UNIT_TOOLTIP} />,
        minWidth: 92,
        flex: 0.4,
      },
      {
        field: "expectedQty",
        headerName: "Current count",
        headerComponent: () => (
          <TooltipHeader label="Current count" tooltip={STOCKTAKE_CURRENT_QTY_TOOLTIP} />
        ),
        minWidth: 148,
        flex: 0.55,
        cellClass: "text-right",
        valueFormatter: ({ value }) => formatQuantity(value),
      },
      {
        field: "countedQty",
        headerName: "New count",
        headerComponent: () => (
          <TooltipHeader label="New count" tooltip={STOCKTAKE_COUNT_QTY_TOOLTIP} />
        ),
        minWidth: 140,
        flex: 0.55,
        editable: (params) =>
          canEditCounts &&
          (params.data
            ? isLotDisplayRow(params.data) || params.data.lots.length === 0
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
      {
        colId: "variance",
        headerName: "Variance",
        headerComponent: () => (
          <TooltipHeader label="Variance" tooltip={STOCKTAKE_LINE_VARIANCE_TOOLTIP} />
        ),
        minWidth: 150,
        flex: 0.55,
        cellClass: "text-right",
        valueGetter: ({ data }) => {
          if (!data) return null;
          if (isLotDisplayRow(data)) {
            if (!data.countedQty) return null;
            return normalizeNumeric(Number(data.countedQty) - Number(data.expectedQty));
          }
          if (data.lots.length > 0) return getLotBackedVarianceQty(data.lots);
          if (!data.countedQty) return null;
          return normalizeNumeric(Number(data.countedQty) - parseFloat(data.expectedQty));
        },
        valueFormatter: ({ value }) => (value == null ? "" : formatQuantity(value)),
      },
    ];
  }, [canEditCounts, previewItemMap, previewItems, timeZone]);

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
      unitName: "",
      expectedQty: "0",
      countedQty: null,
      varianceQty: null,
      appliedDeltaQty: null,
      sortOrder: rows.length,
      lots: [],
      createdAt: now,
      updatedAt: now,
    };
  }, [rows.length]);

  const handleLotCountChange = useCallback(
    (lineId: string, lotLineId: string, value: string | null, commit = false) => {
      const countedQty = normalizeCountedQtyInput(value);
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
    [commitStocktakePatch]
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
    },
    [commitItemIds, commitStocktakePatch, filteredLines, handleLotCountChange, rows]
  );

  const applyScope = (scope: StocktakeScope) => {
    const nextName = buildStocktakeName(scope);
    const nextRows = previewItems
      .filter((item) => itemMatchesScope(item, scope))
      .map((item, index) => {
        const existing = rows.find((row) => row.itemId === item.id);
        const now = new Date();
        return {
          id: existing?.id ?? `new-${item.id}`,
          isNew: existing == null,
          itemId: item.id,
          itemName: item.name,
          itemSku: item.sku,
          itemType: item.itemType,
          unitName: item.unitName,
          expectedQty: existing?.expectedQty ?? item.currentQty,
          countedQty: existing?.countedQty ?? null,
          varianceQty: existing?.varianceQty ?? null,
          appliedDeltaQty: existing?.appliedDeltaQty ?? null,
          sortOrder: index,
          lots: existing?.lots ?? [],
          createdAt: existing?.createdAt ?? now,
          updatedAt: existing?.updatedAt ?? now,
        };
      });
    setStocktakeScope(scope);
    setStocktakeName(nextName);
    setRows(nextRows);
    commitStocktakePatch({
      name: nextName,
      scope,
      itemIds: nextRows.map((row) => row.itemId),
    });
  };

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
                  label: "Print",
                  onClick: () => window.print(),
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
            <div className={`${styles.formRow} ${styles.formRowThree}`}>
              <CellShell label="Name" required>
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
              </CellShell>
              <CellShell label="Scope">
                <Select
                  value={stocktakeScope}
                  disabled={!canEditCounts}
                  onValueChange={(value) => applyScope(value as StocktakeScope)}
                >
                  <SelectTrigger className={styles.underlineControl}>
                    <SelectValue placeholder="Select scope" />
                  </SelectTrigger>
                  <SelectContent>
                    {scopeGroups.map((group) => (
                      <SelectGroup key={group.label}>
                        <SelectLabel>{group.label}</SelectLabel>
                        {group.options.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ))}
                  </SelectContent>
                </Select>
              </CellShell>
              <CellShell label="Status">
                <div className={styles.readOnlyFieldValue}>{formatScope(stocktakeScope)}</div>
              </CellShell>
            </div>
          </CardSection>

          {actionError ? (
            <CardSection aria-label="Stocktake errors">
              {actionError ? <FieldError>{actionError}</FieldError> : null}
            </CardSection>
          ) : null}

          {canEditCounts && liveCountedCount === 0 ? (
            <CardSection aria-label="Stocktake completion guidance">
              <p className="text-[length:var(--text-sm)] text-muted-foreground">
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
              minHeight={180}
            />
          </CardSection>

          <CardSection title="Notes">
            <textarea
              aria-label="Notes"
              className="min-h-32 w-full resize-y border-0 bg-transparent p-0 text-[length:var(--text-sm)] outline-none disabled:text-muted-foreground"
              value={stocktakeNotes}
              disabled={!canEditCounts}
              onChange={(event) => setStocktakeNotes(event.target.value)}
              onBlur={(event) => {
                const notes = event.currentTarget.value;
                if (notes !== (stocktake.notes ?? "")) {
                  commitStocktakePatch({ notes: notes || null });
                }
              }}
            />
          </CardSection>
        </CardPageBody>
      </CardPage>

      {deleteConfirm.dialog}
    </>
  );
}

function itemMatchesScope(item: StocktakePreviewItem, scope: StocktakeScope) {
  const parsedScope = parseStocktakeScope(scope);

  if (parsedScope.kind === "all") return true;
  if (parsedScope.kind === "type") return item.stocktakeType === parsedScope.itemType;
  return (
    item.stocktakeType === parsedScope.itemType &&
    item.category === parsedScope.category
  );
}

function mergeStocktakeUpdatePayload(
  current: StocktakeUpdatePayload,
  patch: StocktakeUpdatePayload
): StocktakeUpdatePayload {
  return {
    ...current,
    ...patch,
    lines: patch.lines ?? current.lines,
    lotLines: patch.lotLines ?? current.lotLines,
    itemIds: patch.itemIds ?? current.itemIds,
  };
}

function cardSaveStateFromEngine(state: "idle" | "dirty" | "saving" | "saved" | "error"): CardSaveState {
  if (state === "dirty" || state === "saving") return "saving";
  if (state === "error") return "failed";
  return "saved";
}
