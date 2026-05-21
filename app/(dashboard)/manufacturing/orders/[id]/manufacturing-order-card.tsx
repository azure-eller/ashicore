"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import type { ICellRendererParams } from "ag-grid-community";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Cancel01Icon,
  MoreVerticalIcon,
  PrinterIcon,
} from "@hugeicons/core-free-icons";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import {
  EditableLineDataGrid,
  type ColDef,
  type EditableLineDataGridChange,
} from "@/components/editable-line-data-grid";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { createIdempotencyHeaders } from "@/lib/api/idempotency-client";
import { useSmartBack } from "@/lib/hooks/use-smart-back";
import { formatDate, formatPrice, formatQuantity } from "@/lib/format";
import {
  createManufacturingOrder,
  fetchManufacturingOrder,
  fetchSalesOrderOptions,
  patchManufacturingOrder,
  patchManufacturingOrderIngredient,
  reorderManufacturingOrderIngredients,
  saveManufacturingOrderIngredients,
} from "@/lib/api/clients/manufacturing-orders";
import { StatusPicker } from "@/components/manufacturing/status-picker";
import {
  LotStrategyChip,
  type PickedLotSummary,
} from "@/components/manufacturing/lot-strategy-chip";
import { ManufacturingIngredientLotCard } from "@/components/manufacturing/ingredient-lot-card";
import { useMoSaveStatus, type MoSaveStatus } from "@/components/manufacturing/use-mo-save-status";
import {
  deriveProductionStatus,
  type ProductionStatus,
} from "@/lib/manufacturing/derive-status";
import type {
  ManufacturingOrderDetail,
  ManufacturingOrderIngredientDetail,
  ManufacturingOrderOperationCostDetail,
} from "@/app/(dashboard)/manufacturing/types";
import type { ManufacturingLotStrategy } from "@/lib/schemas/manufacturing-orders";
import { cn } from "@/lib/utils";
import styles from "@/components/card-page/card-page.module.css";

export type ManufacturingProductOption = {
  id: string;
  name: string;
  sku: string | null;
  unitName: string;
  bom: Array<{ itemId: string; quantityPerUnit: string }>;
};

export function ManufacturingOrderCard({
  initialOrderId,
  initialOrder,
  productOptions = [],
}: {
  initialOrderId: string | null;
  initialOrder: ManufacturingOrderDetail | null;
  productOptions?: ManufacturingProductOption[];
}) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [currentOrderId, setCurrentOrderId] = useState<string | null>(initialOrderId);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [lotPickerIngredient, setLotPickerIngredient] =
    useState<ManufacturingOrderIngredientDetail | null>(null);
  // Draft header fields (used until a product is chosen and the order created).
  const [draftPlannedQuantity, setDraftPlannedQuantity] = useState("1");
  const [draftPlannedDate, setDraftPlannedDate] = useState("");
  const goBack = useSmartBack("/manufacturing/orders");

  const isDraft = currentOrderId == null;

  const orderQuery = useQuery({
    queryKey: ["manufacturing-order", currentOrderId ?? "__draft__"],
    queryFn: () => fetchManufacturingOrder(currentOrderId as string),
    initialData: initialOrder ?? undefined,
    enabled: !isDraft,
    refetchOnWindowFocus: false,
  });
  const order = isDraft ? null : orderQuery.data ?? initialOrder;

  const salesOrderOptionsQuery = useQuery({
    queryKey: ["manufacturing-sales-order-options"],
    queryFn: fetchSalesOrderOptions,
    staleTime: 60_000,
  });
  const salesOrderOptions = salesOrderOptionsQuery.data ?? [];

  const refreshOrder = useCallback(() => {
    if (currentOrderId == null) return;
    void queryClient.invalidateQueries({ queryKey: ["manufacturing-order", currentOrderId] });
  }, [currentOrderId, queryClient]);

  const createMutation = useMutation({
    mutationKey: ["mo", "__draft__", "create"],
    mutationFn: createManufacturingOrder,
    onSuccess: (result) => {
      setCurrentOrderId(result.id);
      window.history.replaceState(null, "", `/manufacturing/orders/${result.id}`);
      void queryClient.invalidateQueries({ queryKey: ["manufacturing-orders"] });
      void queryClient.invalidateQueries({ queryKey: ["manufacturing-order", result.id] });
    },
  });

  const onPickProduct = (productId: string | null) => {
    if (!productId || createMutation.isPending) return;
    const product = productOptions.find((option) => option.id === productId);
    if (!product) return;
    const plannedQuantity = draftPlannedQuantity.trim() || "1";
    createMutation.mutate({
      productId,
      plannedQuantity,
      plannedDate: draftPlannedDate || null,
      ingredients: product.bom.map((row) => ({
        itemId: row.itemId,
        quantityPerUnit: row.quantityPerUnit,
      })),
    });
  };

  const duplicateMutation = useMutation({
    mutationKey: ["mo", currentOrderId ?? "__draft__", "duplicate"],
    mutationFn: async () => {
      const response = await fetch(
        `/api/manufacturing-orders/${currentOrderId}/duplicate`,
        { method: "POST", headers: createIdempotencyHeaders("manufacturing-order-duplicate") },
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Failed to duplicate order.");
      return body as { id: string };
    },
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: ["manufacturing-orders"] });
      router.push(`/manufacturing/orders/${created.id}`);
    },
  });

  const deleteMutation = useMutation({
    mutationKey: ["mo", currentOrderId ?? "__draft__", "delete"],
    mutationFn: async () => {
      const response = await fetch(`/api/manufacturing-orders/${currentOrderId}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to delete order.");
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["manufacturing-orders"] });
      goBack();
    },
  });
  const lotAllocationMutation = useMutation({
    mutationKey: ["mo", currentOrderId ?? "__draft__", "ingredient-lot-allocation"],
    mutationFn: ({
      ingredientId,
      allocations,
    }: {
      ingredientId: string;
      allocations: Array<{ sourceId: string; quantity: string }>;
    }) =>
      patchManufacturingOrderIngredient(currentOrderId!, ingredientId, {
        lotStrategy: "custom",
        allocations,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["manufacturing-order", currentOrderId],
      });
      void queryClient.invalidateQueries({ queryKey: ["manufacturing-orders"] });
    },
  });

  const productionStatus: ProductionStatus | null = order
    ? deriveProductionStatus({
        status: order.status,
        isBlocked: order.isBlocked,
        pickProgressStatus: order.pickProgressStatus,
        completedBatchCount: order.batches.filter((batch) => batch.status === "completed")
          .length,
      })
    : null;

  const canEdit = order == null || order.status === "open";
  const saveStatus = useMoSaveStatus(currentOrderId ?? "__draft__");
  const headerSaveStatus: MoSaveStatus | "draft" = isDraft
    ? createMutation.isPending
      ? "saving"
      : createMutation.isError
        ? "error"
        : "draft"
    : saveStatus.status;

  const selectedProductName = order?.productName ?? null;

  return (
    <div className={styles.sheet}>
      <header className={styles.header}>
        <div className={styles.headerIdentity}>
          <div className={styles.eyebrow}>
            Manufacturing order{selectedProductName ? ` · ${selectedProductName}` : ""}
          </div>
          {order ? (
            <>
              <h1 className={styles.title}>
                <span className={styles.mono}>{order.orderNumber}</span>
                {" "}
                <span className="ml-3">{order.productName}</span>
                {order.productSku ? (
                  <span
                    className={cn(
                      styles.mono,
                      "ml-2 text-[14px] font-medium text-[var(--color-muted)]",
                    )}
                  >
                    {" "}
                    / {order.productSku}
                  </span>
                ) : null}
              </h1>
              <MoDescription order={order} />
            </>
          ) : (
            <div className="mt-1 max-w-md">
              <Combobox
                items={productOptions.map((option) => option.id)}
                value=""
                onValueChange={(value) => onPickProduct(value || null)}
                itemToStringLabel={(value) =>
                  productOptions.find((option) => option.id === value)?.name ?? ""
                }
              >
                <ComboboxInput placeholder="Search or create product…" showClear />
                <ComboboxContent className="bg-popover text-popover-foreground">
                  <ComboboxEmpty>No manufacturable products found</ComboboxEmpty>
                  <ComboboxList>
                    {(id: string) => {
                      const option = productOptions.find((entry) => entry.id === id);
                      return (
                        <ComboboxItem key={id} value={id}>
                          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                            <span className="truncate">{option?.name}</span>
                            {option?.sku ? (
                              <span className="font-mono text-xs text-muted-foreground">
                                {option.sku}
                              </span>
                            ) : null}
                          </div>
                        </ComboboxItem>
                      );
                    }}
                  </ComboboxList>
                </ComboboxContent>
              </Combobox>
            </div>
          )}
        </div>
        <div className={styles.headerRight}>
          <SaveStatusPill status={headerSaveStatus} />
          {order && productionStatus ? (
            <StatusPicker orderId={order.id} current={productionStatus} onChanged={refreshOrder} />
          ) : null}
          <button
            type="button"
            className={styles.iconBtn}
            aria-label="Print"
            title="Print"
            onClick={() => window.print()}
            disabled={!order}
          >
            <HugeiconsIcon icon={PrinterIcon} size={14} />
          </button>
          {order ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className={styles.iconBtn} aria-label="More actions">
                  <HugeiconsIcon icon={MoreVerticalIcon} size={14} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <Link href={`/manufacturing/orders/${order.id}/execute`}>Open execution</Link>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => duplicateMutation.mutate()}>
                  Duplicate
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setDeleteOpen(true)}>
                  Delete order
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          <button type="button" className={styles.iconBtn} aria-label="Close" onClick={goBack}>
            <HugeiconsIcon icon={Cancel01Icon} size={14} />
          </button>
        </div>
      </header>

      <div className={styles.body}>
        <OrderDetailsSection
          order={order}
          canEdit={canEdit}
          draftPlannedQuantity={draftPlannedQuantity}
          draftPlannedDate={draftPlannedDate}
          onDraftPlannedQuantity={setDraftPlannedQuantity}
          onDraftPlannedDate={setDraftPlannedDate}
          salesOrderOptions={salesOrderOptions}
          onPatched={refreshOrder}
        />
        <IngredientsSection
          order={order}
          canEdit={canEdit}
          onOpenLotPicker={(ingredient) => setLotPickerIngredient(ingredient)}
          onChanged={refreshOrder}
        />
        <OperationsSection order={order} />
        <NotesSection order={order} canEdit={canEdit} onPatched={refreshOrder} />
      </div>

      {lotPickerIngredient ? (
        <Dialog
          open={lotPickerIngredient != null}
          onOpenChange={(open) => {
            if (!open) {
              setLotPickerIngredient(null);
              refreshOrder();
            }
          }}
        >
          <DialogContent size="lg" className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Pick lots for {lotPickerIngredient.itemName}</DialogTitle>
            </DialogHeader>
            <ManufacturingIngredientLotCard
              itemId={lotPickerIngredient.itemId}
              ingredientId={lotPickerIngredient.id}
              itemName={lotPickerIngredient.itemName}
              unitName={lotPickerIngredient.unitName}
              plannedQuantity={lotPickerIngredient.plannedQuantity}
              value={undefined}
              manufacturingOrderId={currentOrderId}
              autoAllocateOnSave={false}
              onChange={(allocations) => {
                lotAllocationMutation.mutate({
                  ingredientId: lotPickerIngredient.id,
                  allocations,
                });
              }}
            />
          </DialogContent>
        </Dialog>
      ) : null}

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this order?</AlertDialogTitle>
            <AlertDialogDescription>
              Open orders are removed from normal views and reversible picked or
              reserved inventory is released. Production output blocks deletion.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Back</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteMutation.isPending}
              onClick={(event) => {
                event.preventDefault();
                deleteMutation.mutate();
              }}
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete Order"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function MoDescription({ order }: { order: ManufacturingOrderDetail }) {
  const batches = order.numberOfBatches ?? 0;
  const due = order.plannedDate ? formatDate(order.plannedDate) : null;
  return (
    <div className={styles.meta}>
      <span>
        Planned <span className={styles.mono}>{formatQuantity(order.plannedQuantity)}</span>{" "}
        {order.unitName}
        {batches > 0 ? ` in ${batches} batch${batches === 1 ? "" : "es"}` : ""}
      </span>
      {due ? (
        <>
          <span className={styles.metaDot} />
          <span>
            Due <span className={styles.mono}>{due}</span>
          </span>
        </>
      ) : null}
      {order.salesOrderNumber ? (
        <>
          <span className={styles.metaDot} />
          <span>
            For{" "}
            <Link
              href={`/sales/orders/${order.salesOrderId}`}
              className="text-[var(--color-accent)] hover:underline"
            >
              {order.salesOrderNumber}
            </Link>
          </span>
        </>
      ) : null}
    </div>
  );
}

function SaveStatusPill({ status }: { status: MoSaveStatus | "draft" }) {
  if (status === "draft") {
    return (
      <span className={styles.failedPill}>
        <span className={styles.pillSquare} /> Not saved
      </span>
    );
  }
  if (status === "saving") {
    return (
      <span className={styles.savingPill}>
        <span className={styles.pillSquare} /> Saving…
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className={styles.failedPill}>
        <span className={styles.pillSquare} /> Save failed
      </span>
    );
  }
  return (
    <span className={styles.savedPill}>
      <span className={styles.pillSquare} /> All changes saved
    </span>
  );
}

function OrderDetailsSection({
  order,
  canEdit,
  draftPlannedQuantity,
  draftPlannedDate,
  onDraftPlannedQuantity,
  onDraftPlannedDate,
  salesOrderOptions,
  onPatched,
}: {
  order: ManufacturingOrderDetail | null;
  canEdit: boolean;
  draftPlannedQuantity: string;
  draftPlannedDate: string;
  onDraftPlannedQuantity: (value: string) => void;
  onDraftPlannedDate: (value: string) => void;
  salesOrderOptions: Array<{ id: string; orderNumber: string; customerName: string }>;
  onPatched: () => void;
}) {
  const queryClient = useQueryClient();
  const unitName = order?.unitName ?? "";
  const actualNumber = order?.actualQuantity != null ? Number(order.actualQuantity) : 0;
  const plannedNumber = order ? Number(order.plannedQuantity) : 0;
  const progressPct =
    plannedNumber > 0 ? Math.min(100, Math.round((actualNumber / plannedNumber) * 100)) : 0;

  const patchField = useMutation({
    mutationKey: ["mo", order?.id ?? "__draft__", "header"],
    mutationFn: (patch: Parameters<typeof patchManufacturingOrder>[1]) =>
      patchManufacturingOrder(order!.id, patch),
    onSuccess: () => {
      onPatched();
      void queryClient.invalidateQueries({ queryKey: ["manufacturing-orders"] });
    },
  });
  const savePlannedQuantity = useMutation({
    mutationKey: ["mo", order?.id ?? "__draft__", "planned-quantity"],
    mutationFn: (plannedQuantity: string) =>
      saveManufacturingOrderIngredients(
        order!.id,
        {
          plannedQuantity,
          plannedDate: order!.plannedDate,
          notes: order!.notes,
          salesOrderId: order!.salesOrderId,
          salesOrderLineId: order!.salesOrderLineId,
        },
        order!.ingredients.map((ingredient) => ({
          itemId: ingredient.itemId,
          quantityPerUnit: ingredient.quantityPerUnit,
        })),
      ),
    onSuccess: () => {
      onPatched();
      void queryClient.invalidateQueries({ queryKey: ["manufacturing-orders"] });
    },
  });

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionHeading}>Order details</h2>
      <div className="grid grid-cols-3 border border-[var(--color-line)]">
        <DetailCell label="Planned quantity">
          {canEdit ? (
            <Input
              key={order?.plannedQuantity ?? "draft"}
              defaultValue={order ? order.plannedQuantity : draftPlannedQuantity}
              onBlur={(event) => {
                const next = event.target.value.trim();
                if (!next) return;
                if (order) {
                  if (next !== order.plannedQuantity) savePlannedQuantity.mutate(next);
                } else {
                  onDraftPlannedQuantity(next);
                }
              }}
              inputMode="decimal"
              className="h-7 border-0 bg-transparent p-0 font-mono text-[15px] font-semibold tabular-nums focus-visible:ring-0"
              aria-label="Planned quantity"
            />
          ) : (
            <span className="font-mono text-[15px] font-semibold tabular-nums">
              {order ? formatQuantity(order.plannedQuantity) : "—"}
            </span>
          )}
          {unitName ? <span className="ml-1 text-[11px] text-[var(--color-muted)]">{unitName}</span> : null}
        </DetailCell>
        <DetailCell label="Actual / Planned">
          <div className="flex flex-col gap-1">
            <div>
              <span className="font-mono text-[15px] font-semibold tabular-nums">
                {order?.actualQuantity != null ? formatQuantity(order.actualQuantity) : "—"} /{" "}
                {order ? formatQuantity(order.plannedQuantity) : "—"}
              </span>
              {unitName ? (
                <span className="ml-1 text-[11px] text-[var(--color-muted)]">{unitName}</span>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <div className="h-[5px] w-[120px] bg-[var(--color-surface-sunk)]">
                <div
                  className={cn(
                    "h-full",
                    progressPct >= 100
                      ? "bg-[var(--color-success)]"
                      : "bg-[var(--color-warning)]",
                  )}
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <span className="font-mono text-[11px] text-[var(--color-muted)] tabular-nums">
                {progressPct}%
              </span>
            </div>
          </div>
        </DetailCell>
        <DetailCell label="Yield per batch">
          {order?.expectedBatchYield ? (
            <span className="font-mono text-[15px] font-semibold tabular-nums">
              {formatQuantity(order.expectedBatchYield)}
            </span>
          ) : (
            <span className="text-[var(--color-muted-2)]">—</span>
          )}
          {order?.numberOfBatches ? (
            <span className="ml-1 text-[11px] text-[var(--color-muted)]">
              {unitName} · {order.numberOfBatches} batch{order.numberOfBatches === 1 ? "" : "es"}
            </span>
          ) : null}
        </DetailCell>
        <DetailCell label="Planned date">
          {canEdit ? (
            <DatePicker
              aria-label="Planned date"
              value={order ? order.plannedDate ?? "" : draftPlannedDate}
              onChange={(next) => {
                const normalized = next || null;
                if (order) {
                  if (normalized !== order.plannedDate) patchField.mutate({ plannedDate: normalized });
                } else {
                  onDraftPlannedDate(next);
                }
              }}
            />
          ) : (
            <span className="font-mono text-[13px] tabular-nums">
              {order?.plannedDate ? formatDate(order.plannedDate) : "—"}
            </span>
          )}
        </DetailCell>
        <DetailCell label="Created">
          <span className="font-mono text-[13px] tabular-nums">
            {order ? formatDate(new Date(order.createdAt).toISOString().slice(0, 10)) : "—"}
          </span>
        </DetailCell>
        <DetailCell label="Sales order">
          {order && canEdit ? (
            <Combobox
              items={salesOrderOptions.map((option) => option.id)}
              value={order.salesOrderId ?? ""}
              onValueChange={(value) =>
                patchField.mutate({ salesOrderId: value || null, salesOrderLineId: null })
              }
              itemToStringLabel={(value) => {
                const option = salesOrderOptions.find((entry) => entry.id === value);
                return option ? `${option.orderNumber} (${option.customerName})` : "";
              }}
            >
              <ComboboxInput placeholder="No sales order" showClear />
              <ComboboxContent className="bg-popover text-popover-foreground">
                <ComboboxEmpty>No open sales orders</ComboboxEmpty>
                <ComboboxList>
                  {(id: string) => {
                    const option = salesOrderOptions.find((entry) => entry.id === id);
                    return (
                      <ComboboxItem key={id} value={id}>
                        {option ? `${option.orderNumber} (${option.customerName})` : id}
                      </ComboboxItem>
                    );
                  }}
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
          ) : (
            <span className="text-[13px] text-[var(--color-muted)]">No sales order</span>
          )}
        </DetailCell>
      </div>
    </section>
  );
}

function DetailCell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-h-[56px] border-r border-b border-[var(--color-line-2)] px-3.5 py-2.5 last:border-r-0">
      <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--color-muted)]">
        {label}
      </div>
      <div className="text-[13px] text-[var(--color-ink)]">{children}</div>
    </div>
  );
}

function IngredientsSection({
  order,
  canEdit,
  onOpenLotPicker,
  onChanged,
}: {
  order: ManufacturingOrderDetail | null;
  canEdit: boolean;
  onOpenLotPicker: (ingredient: ManufacturingOrderIngredientDetail) => void;
  onChanged: () => void;
}) {
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] =
    useState<ManufacturingOrderIngredientDetail | null>(null);

  const ingredients = useMemo(() => order?.ingredients ?? [], [order]);
  const [rows, setRows] = useState<ManufacturingOrderIngredientDetail[]>(ingredients);
  const [lastSynced, setLastSynced] = useState(ingredients);
  if (lastSynced !== ingredients) {
    setLastSynced(ingredients);
    setRows(ingredients);
  }

  const materialCost = ingredients.reduce((total, ingredient) => {
    const cost = Number(ingredient.actualCostTotal ?? 0);
    return Number.isFinite(cost) ? total + cost : total;
  }, 0);

  const reorderMutation = useMutation({
    mutationKey: ["mo", order?.id ?? "__draft__", "ingredient-reorder"],
    mutationFn: (ids: string[]) => reorderManufacturingOrderIngredients(order!.id, ids),
    onSettled: onChanged,
  });

  const saveIngredientsMutation = useMutation({
    mutationKey: ["mo", order?.id ?? "__draft__", "ingredient-save"],
    mutationFn: (next: ManufacturingOrderIngredientDetail[]) =>
      saveManufacturingOrderIngredients(
        order!.id,
        {
          plannedQuantity: order!.plannedQuantity,
          plannedDate: order!.plannedDate,
          notes: order!.notes,
          salesOrderId: order!.salesOrderId,
          salesOrderLineId: order!.salesOrderLineId,
        },
        next.map((row) => ({ itemId: row.itemId, quantityPerUnit: row.quantityPerUnit })),
      ),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["manufacturing-orders"] });
      onChanged();
    },
  });

  const handleRowsChange = useCallback(
    (
      next: ManufacturingOrderIngredientDetail[],
      change: EditableLineDataGridChange<ManufacturingOrderIngredientDetail>,
    ) => {
      setRows(next);
      if (change.type === "row_reordered" && order) {
        reorderMutation.mutate(next.map((row) => row.id));
      }
    },
    [order, reorderMutation],
  );

  const columns = useMemo<ColDef<ManufacturingOrderIngredientDetail>[]>(
    () => [
      {
        colId: "ingredient",
        headerName: "Ingredient",
        flex: 1.5,
        minWidth: 220,
        valueGetter: (params) => params.data?.itemName ?? "",
        cellRenderer: (params: ICellRendererParams<ManufacturingOrderIngredientDetail>) => {
          if (!params.data) return null;
          const sub = [params.data.itemType, params.data.unitName].filter(Boolean).join(" · ");
          return (
            <div className="flex flex-col leading-tight">
              <span className="text-[13px] font-medium text-[var(--color-ink)]">
                {params.data.itemName}
              </span>
              {sub ? (
                <span className="text-[11px] text-[var(--color-muted)] capitalize">{sub}</span>
              ) : null}
            </div>
          );
        },
      },
      {
        field: "itemSku",
        headerName: "SKU",
        width: 130,
        cellClass: styles.sku,
        valueFormatter: ({ value }) => (value ? String(value) : "—"),
      },
      {
        field: "plannedQuantity",
        headerName: "Planned",
        type: "rightAligned",
        width: 120,
        cellRenderer: (params: ICellRendererParams<ManufacturingOrderIngredientDetail>) =>
          params.data ? (
            <span>
              <span className={styles.mono}>{formatQuantity(params.data.plannedQuantity)}</span>
              <span className={styles.uom}>{params.data.unitName}</span>
            </span>
          ) : null,
      },
      {
        colId: "pickedActual",
        headerName: "Picked / Actual",
        type: "rightAligned",
        width: 140,
        cellRenderer: (params: ICellRendererParams<ManufacturingOrderIngredientDetail>) => {
          if (!params.data) return null;
          return (
            <div className="flex flex-col items-end leading-tight">
              <span className={styles.mono}>
                {formatQuantity(params.data.pickedQuantity)} /{" "}
                {params.data.actualQuantity != null
                  ? formatQuantity(params.data.actualQuantity)
                  : "—"}
              </span>
              <span className="text-[11px] text-[var(--color-muted)]">
                of {formatQuantity(params.data.plannedQuantity)}
              </span>
            </div>
          );
        },
      },
      {
        colId: "lotAllocation",
        headerName: "Lot allocation",
        flex: 1.2,
        minWidth: 240,
        cellRenderer: (params: ICellRendererParams<ManufacturingOrderIngredientDetail>) => {
          if (!params.data || !order) return null;
          const ingredient = params.data;
          const picked = Number(ingredient.pickedQuantity);
          const summary: PickedLotSummary = {
            count: Number.isFinite(picked) && picked > 0 ? 1 : 0,
            firstLot: null,
            totalQty:
              Number.isFinite(picked) && picked > 0
                ? formatQuantity(ingredient.pickedQuantity)
                : null,
          };
          if (!canEdit) {
            return (
              <span className="text-[11.5px] text-[var(--color-muted)]">
                {summary.count} lot{summary.count === 1 ? "" : "s"}
              </span>
            );
          }
          return (
            <LotStrategyChip
              orderId={order.id}
              ingredientId={ingredient.id}
              strategy={ingredient.lotStrategy as ManufacturingLotStrategy}
              summary={summary}
              onOpenPicker={() => onOpenLotPicker(ingredient)}
            />
          );
        },
      },
      {
        field: "actualCostTotal",
        headerName: "Cost",
        type: "rightAligned",
        width: 110,
        cellClass: styles.mono,
        valueFormatter: ({ value }) => (value != null ? (formatPrice(String(value)) ?? "—") : "—"),
      },
      {
        colId: "requirements",
        headerName: "Requirements",
        width: 160,
        cellRenderer: (params: ICellRendererParams<ManufacturingOrderIngredientDetail>) => {
          const constraints = params.data?.constraints ?? [];
          if (constraints.length === 0) return <span className={styles.placeholder}>—</span>;
          return (
            <span className="inline-flex flex-wrap gap-1">
              {constraints.map((constraint, index) => (
                <span
                  key={index}
                  className="inline-flex h-5 items-center bg-[var(--color-warning-soft)] px-1.5 text-[10.5px] font-semibold text-[var(--color-warning)]"
                >
                  {constraint.constraintType === "lot_age_min_days"
                    ? `≥ ${constraint.config.days}d age`
                    : constraint.constraintType}
                </span>
              ))}
            </span>
          );
        },
      },
    ],
    [canEdit, onOpenLotPicker, order],
  );

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionHeading}>
        Ingredients
        <span className="count">
          {ingredients.length} item{ingredients.length === 1 ? "" : "s"}
          {materialCost > 0 ? ` · ${formatPrice(String(materialCost))} material cost` : ""}
        </span>
      </h2>
      <EditableLineDataGrid<ManufacturingOrderIngredientDetail>
        rows={rows}
        columns={columns}
        getRowId={(row) => row.id}
        createRow={() => rows[0]!}
        onRowsChange={handleRowsChange}
        addLabel="Add ingredient"
        emptyMessage="No ingredients yet. Pick a product to populate the bill of materials."
        enableAddRow={false}
        enableReorder={canEdit && order != null}
        enableDelete={canEdit && order != null}
        canDeleteRow={(_row, current) => current.length > 1}
        getDeleteDisabledReason={(_row, current) =>
          current.length <= 1 ? "An order needs at least one ingredient." : null
        }
        onDeleteRow={(row) => setConfirmDelete(row)}
        headerHeight={36}
        rowHeight={46}
        minHeight={110}
      />

      <AlertDialog
        open={confirmDelete != null}
        onOpenChange={(open) => {
          if (!open) setConfirmDelete(null);
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove ingredient?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete?.itemName} will be removed from this order.
              {saveIngredientsMutation.error ? (
                <span className="block mt-(--space-2) text-destructive">
                  {(saveIngredientsMutation.error as Error).message}
                </span>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => saveIngredientsMutation.reset()}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={saveIngredientsMutation.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (!confirmDelete) return;
                const next = rows.filter((row) => row.id !== confirmDelete.id);
                saveIngredientsMutation.mutate(next, {
                  onSuccess: () => setConfirmDelete(null),
                });
              }}
            >
              {saveIngredientsMutation.isPending ? "Removing…" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function OperationsSection({ order }: { order: ManufacturingOrderDetail | null }) {
  const operations = useMemo(() => order?.operationCosts ?? [], [order]);
  const [rows, setRows] = useState<ManufacturingOrderOperationCostDetail[]>(operations);
  const [lastSynced, setLastSynced] = useState(operations);
  if (lastSynced !== operations) {
    setLastSynced(operations);
    setRows(operations);
  }

  const columns = useMemo<ColDef<ManufacturingOrderOperationCostDetail>[]>(
    () => [
      { field: "operationName", headerName: "Operation step", flex: 1.4, minWidth: 200 },
      { field: "resourceName", headerName: "Resource", flex: 1, minWidth: 160 },
      {
        colId: "time",
        headerName: "Time (actual / planned)",
        type: "rightAligned",
        width: 180,
        cellRenderer: (params: ICellRendererParams<ManufacturingOrderOperationCostDetail>) => {
          if (!params.data) return null;
          return (
            <div className="flex flex-col items-end leading-tight">
              <span className={styles.mono}>
                — / {formatQuantity(params.data.plannedMinutes)}
              </span>
              <span className="text-[11px] text-[var(--color-muted)]">minutes</span>
            </div>
          );
        },
      },
      {
        field: "plannedCostTotal",
        headerName: "Cost",
        type: "rightAligned",
        width: 120,
        cellClass: styles.mono,
        valueFormatter: ({ value }) => formatPrice(String(value)) ?? "—",
      },
    ],
    [],
  );

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionHeading}>
        Operations
        <span className="count">
          {operations.length} step{operations.length === 1 ? "" : "s"}
        </span>
      </h2>
      <EditableLineDataGrid<ManufacturingOrderOperationCostDetail>
        rows={rows}
        columns={columns}
        getRowId={(row) => row.id}
        createRow={() => rows[0]!}
        onRowsChange={setRows}
        addLabel="Add operation"
        emptyMessage="No operations for this product."
        enableAddRow={false}
        enableReorder={false}
        enableDelete={false}
        headerHeight={36}
        rowHeight={42}
        minHeight={96}
      />
    </section>
  );
}

function NotesSection({
  order,
  canEdit,
  onPatched,
}: {
  order: ManufacturingOrderDetail | null;
  canEdit: boolean;
  onPatched: () => void;
}) {
  const patchNotes = useMutation({
    mutationKey: ["mo", order?.id ?? "__draft__", "notes"],
    mutationFn: (value: string | null) => patchManufacturingOrder(order!.id, { notes: value }),
    onSuccess: onPatched,
  });

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionHeading}>
        Notes
        <span className="hint">internal only</span>
      </h2>
      {canEdit ? (
        <Textarea
          key={order?.id ?? "draft"}
          aria-label="Notes"
          defaultValue={order?.notes ?? ""}
          onBlur={(event) => {
            if (!order) return;
            const next = event.target.value.trim() || null;
            if (next !== order.notes) patchNotes.mutate(next);
          }}
          rows={3}
          disabled={!order}
          className="min-h-20 border-[var(--color-line)] focus-visible:ring-[var(--color-accent)]"
          placeholder="Notes for this order…"
        />
      ) : (
        <div className="min-h-20 border border-[var(--color-line)] bg-[var(--color-surface-alt)] p-3 text-[13px] text-[var(--color-ink)] whitespace-pre-wrap">
          {order?.notes ?? <span className="text-[var(--color-muted)]">No notes.</span>}
        </div>
      )}
    </section>
  );
}
