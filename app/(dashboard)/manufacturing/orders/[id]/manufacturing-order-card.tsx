"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { useRouter } from "next/navigation";
import { createIdempotencyHeaders } from "@/lib/api/idempotency-client";
import { useSmartBack } from "@/lib/hooks/use-smart-back";
import { formatDate, formatPrice, formatQuantity } from "@/lib/format";
import {
  createManufacturingOrder,
  fetchManufacturingOrder,
  patchManufacturingOrder,
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
  // Draft fields (mirrors the item card's draftCard). Planned quantity
  // defaults to "1" so selecting a product alone creates the order — the
  // single inline action, exactly like typing a product name.
  const [draftProductId, setDraftProductId] = useState<string | null>(null);
  const [draftPlannedQuantity, setDraftPlannedQuantity] = useState("1");
  const [draftPlannedDate, setDraftPlannedDate] = useState<string>("");
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

  const commitDraft = (next?: { productId?: string; plannedQuantity?: string }) => {
    if (currentOrderId != null || createMutation.isPending || createMutation.isSuccess) {
      return;
    }
    const productId = next?.productId ?? draftProductId;
    const plannedQuantity = (next?.plannedQuantity ?? draftPlannedQuantity).trim();
    if (!productId || !plannedQuantity) return;
    const qty = Number(plannedQuantity);
    if (!Number.isFinite(qty) || qty <= 0) return;
    const product = productOptions.find((option) => option.id === productId);
    if (!product) return;

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

  const refreshOrder = () => {
    if (currentOrderId == null) return;
    void queryClient.invalidateQueries({ queryKey: ["manufacturing-order", currentOrderId] });
  };

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

  const draftSaveStatus: MoSaveStatus | "draft" = createMutation.isPending
    ? "saving"
    : createMutation.isError
      ? "error"
      : "draft";

  // ---- Draft sheet (no order yet) ----
  if (isDraft || !order) {
    const selectedProduct = productOptions.find((option) => option.id === draftProductId);
    return (
      <div className={styles.sheet}>
        <header className={styles.header}>
          <div className={styles.headerIdentity}>
            <div className={styles.eyebrow}>Manufacturing order</div>
            <h1 className={styles.title}>
              {selectedProduct ? selectedProduct.name : "New manufacturing order"}
            </h1>
            <div className={styles.meta}>
              <span>Pick a product to start</span>
            </div>
          </div>
          <div className={styles.headerRight}>
            <SaveStatusPill status={draftSaveStatus} />
            <button
              type="button"
              className={styles.iconBtn}
              aria-label="Close"
              onClick={goBack}
            >
              <HugeiconsIcon icon={Cancel01Icon} size={14} />
            </button>
          </div>
        </header>

        <div className={styles.body}>
          <section className={styles.section}>
            <h2 className={styles.sectionHeading}>Order details</h2>
            <div className="grid grid-cols-3 border border-[var(--color-line)]">
              <div className="col-span-2 min-h-[56px] border-r border-b border-[var(--color-line-2)] px-3.5 py-2.5">
                <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--color-muted)]">
                  Product <span className="text-[var(--color-danger)]">*</span>
                </div>
                <Combobox
                  items={productOptions.map((option) => option.id)}
                  value={draftProductId ?? ""}
                  onValueChange={(value) => {
                    const productId = value || null;
                    setDraftProductId(productId);
                    if (productId) commitDraft({ productId });
                  }}
                  itemToStringLabel={(value) => {
                    const option = productOptions.find((entry) => entry.id === value);
                    return option ? option.name : "";
                  }}
                >
                  <ComboboxInput placeholder="Search products…" showClear />
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
              <div className="min-h-[56px] border-b border-[var(--color-line-2)] px-3.5 py-2.5">
                <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--color-muted)]">
                  Planned quantity
                </div>
                <Input
                  value={draftPlannedQuantity}
                  onChange={(event) => setDraftPlannedQuantity(event.target.value)}
                  onBlur={() => commitDraft()}
                  inputMode="decimal"
                  className="h-7 border-0 bg-transparent p-0 font-mono text-[15px] font-semibold tabular-nums focus-visible:ring-0"
                  aria-label="Planned quantity"
                />
              </div>
              <div className="col-span-3 min-h-[56px] px-3.5 py-2.5">
                <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--color-muted)]">
                  Planned date
                </div>
                <DatePicker
                  aria-label="Planned date"
                  value={draftPlannedDate}
                  onChange={(next) => setDraftPlannedDate(next)}
                />
              </div>
            </div>
            {createMutation.isError ? (
              <p className="mt-2 text-[12px] text-[var(--color-danger)]">
                {(createMutation.error as Error).message}
              </p>
            ) : null}
          </section>
        </div>
      </div>
    );
  }

  // ---- Saved sheet ----
  const productionStatus: ProductionStatus = deriveProductionStatus({
    status: order.status,
    isBlocked: order.isBlocked,
    pickProgressStatus: order.pickProgressStatus,
    completedBatchCount: order.batches.filter((batch) => batch.status === "completed").length,
  });

  const canEdit = order.status === "open";

  return (
    <div className={styles.sheet}>
      <MoSheetHeader
        order={order}
        productionStatus={productionStatus}
        moId={order.id}
        onChangedStatus={refreshOrder}
        onClose={goBack}
        onDelete={() => setDeleteOpen(true)}
        onDuplicate={() => duplicateMutation.mutate()}
      />

      <div className={styles.body}>
        <OrderDetailsSection order={order} canEdit={canEdit} onPatched={refreshOrder} />
        <IngredientsSection
          order={order}
          canEdit={canEdit}
          onOpenLotPicker={(ingredient) => setLotPickerIngredient(ingredient)}
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
              <DialogTitle>
                Pick lots for {lotPickerIngredient.itemName}
              </DialogTitle>
            </DialogHeader>
            <ManufacturingIngredientLotCard
              itemId={lotPickerIngredient.itemId}
              ingredientId={lotPickerIngredient.id}
              itemName={lotPickerIngredient.itemName}
              unitName={lotPickerIngredient.unitName}
              plannedQuantity={lotPickerIngredient.plannedQuantity}
              value={undefined}
              manufacturingOrderId={initialOrderId}
              autoAllocateOnSave={false}
              onChange={() => {
                // Persisting picks happens through existing picking flow; for v1
                // the inline picker only previews allocation. Future iteration
                // will plumb { sourceId, qty } back to a save endpoint.
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
              Open orders are removed from normal views and reversible picked
              or reserved inventory is released. Production output blocks
              deletion. This action cannot be undone.
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

function MoSheetHeader({
  order,
  productionStatus,
  moId,
  onChangedStatus,
  onClose,
  onDelete,
  onDuplicate,
}: {
  order: ManufacturingOrderDetail;
  productionStatus: ProductionStatus;
  moId: string;
  onChangedStatus: () => void;
  onClose: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
}) {
  const save = useMoSaveStatus(moId);
  const batches = order.numberOfBatches ?? 0;
  const due = order.plannedDate ? formatDate(order.plannedDate) : null;

  return (
    <header className={styles.header}>
      <div className={styles.headerIdentity}>
        <div className={styles.eyebrow}>
          Manufacturing order · {order.productName}
        </div>
        <h1 className={styles.title}>
          <span className={styles.mono}>{order.orderNumber}</span>
          <span className="ml-3">{order.productName}</span>
          {order.productSku ? (
            <span
              className={cn(
                styles.mono,
                "ml-2 text-[14px] font-medium text-[var(--color-muted)]",
              )}
            >
              / {order.productSku}
            </span>
          ) : null}
        </h1>
        <div className={styles.meta}>
          <span>
            Planned <span className={styles.mono}>{formatQuantity(order.plannedQuantity)}</span>{" "}
            {order.unitName}
            {batches > 0 ? ` in ${batches} batch${batches === 1 ? "" : "es"}` : ""}
          </span>
          {due ? (
            <>
              <span className={styles.metaDot} />
              <span>Due <span className={styles.mono}>{due}</span></span>
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
      </div>
      <div className={styles.headerRight}>
        <SaveStatusPill status={save.status} />
        <StatusPicker orderId={moId} current={productionStatus} onChanged={onChangedStatus} />
        <button
          type="button"
          className={styles.iconBtn}
          aria-label="Print"
          title="Print"
          onClick={() => window.print()}
        >
          <HugeiconsIcon icon={PrinterIcon} size={14} />
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className={styles.iconBtn} aria-label="More actions">
              <HugeiconsIcon icon={MoreVerticalIcon} size={14} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link href={`/manufacturing/orders/${moId}/execute`}>
                Open execution
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onDuplicate}>Duplicate</DropdownMenuItem>
            <DropdownMenuItem onSelect={onDelete}>
              Delete order
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <button
          type="button"
          className={styles.iconBtn}
          aria-label="Close"
          onClick={onClose}
        >
          <HugeiconsIcon icon={Cancel01Icon} size={14} />
        </button>
      </div>
    </header>
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
  onPatched,
}: {
  order: ManufacturingOrderDetail;
  canEdit: boolean;
  onPatched: (patch: Partial<ManufacturingOrderDetail>) => void;
}) {
  const queryClient = useQueryClient();
  const actualNumber = order.actualQuantity != null ? Number(order.actualQuantity) : 0;
  const plannedNumber = Number(order.plannedQuantity);
  const progressPct =
    plannedNumber > 0 ? Math.min(100, Math.round((actualNumber / plannedNumber) * 100)) : 0;

  const patchPlannedQty = useMutation({
    mutationKey: ["mo", order.id, "plannedQuantity"],
    mutationFn: (value: string) => patchManufacturingOrder(order.id, { plannedQuantity: value }),
    onSuccess: (_data, value) => {
      onPatched({ plannedQuantity: value });
      void queryClient.invalidateQueries({ queryKey: ["manufacturing-orders"] });
    },
  });

  const patchPlannedDate = useMutation({
    mutationKey: ["mo", order.id, "plannedDate"],
    mutationFn: (value: string | null) => patchManufacturingOrder(order.id, { plannedDate: value }),
    onSuccess: (_data, value) => {
      onPatched({ plannedDate: value });
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
              defaultValue={order.plannedQuantity}
              onBlur={(event) => {
                const next = event.target.value.trim();
                if (next && next !== order.plannedQuantity) {
                  patchPlannedQty.mutate(next);
                }
              }}
              inputMode="decimal"
              className="h-7 border-0 bg-transparent p-0 font-mono text-[15px] font-semibold tabular-nums focus-visible:ring-0"
              aria-label="Planned quantity"
            />
          ) : (
            <span className="font-mono text-[15px] font-semibold tabular-nums">
              {formatQuantity(order.plannedQuantity)}
            </span>
          )}
          <span className="ml-1 text-[11px] text-[var(--color-muted)]">{order.unitName}</span>
        </DetailCell>
        <DetailCell label="Actual / Planned">
          <div className="flex flex-col gap-1">
            <div>
              <span className="font-mono text-[15px] font-semibold tabular-nums">
                {order.actualQuantity != null ? formatQuantity(order.actualQuantity) : "—"} /{" "}
                {formatQuantity(order.plannedQuantity)}
              </span>
              <span className="ml-1 text-[11px] text-[var(--color-muted)]">{order.unitName}</span>
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
          {order.expectedBatchYield ? (
            <span className="font-mono text-[15px] font-semibold tabular-nums">
              {formatQuantity(order.expectedBatchYield)}
            </span>
          ) : (
            <span className="text-[var(--color-muted-2)]">—</span>
          )}
          {order.numberOfBatches ? (
            <span className="ml-1 text-[11px] text-[var(--color-muted)]">
              {order.unitName} · {order.numberOfBatches} batch
              {order.numberOfBatches === 1 ? "" : "es"}
            </span>
          ) : null}
        </DetailCell>
        <DetailCell label="Planned date">
          {canEdit ? (
            <DatePicker
              aria-label="Planned date"
              value={order.plannedDate ?? ""}
              onChange={(next) => {
                const normalized = next || null;
                if (normalized !== order.plannedDate) {
                  patchPlannedDate.mutate(normalized);
                }
              }}
            />
          ) : (
            <span className="font-mono text-[13px] tabular-nums">
              {order.plannedDate ? formatDate(order.plannedDate) : "—"}
            </span>
          )}
        </DetailCell>
        <DetailCell label="Created">
          <span className="font-mono text-[13px] tabular-nums">
            {formatDate(new Date(order.createdAt).toISOString().slice(0, 10))}
          </span>
        </DetailCell>
        <DetailCell label="Sales order">
          {order.salesOrderId && order.salesOrderNumber ? (
            <Link
              href={`/sales/orders/${order.salesOrderId}`}
              className="text-[13px] text-[var(--color-accent)] hover:underline"
            >
              {order.salesOrderNumber}
              {order.salesCustomerName ? (
                <span className="ml-1 text-[var(--color-muted)]">
                  ({order.salesCustomerName})
                </span>
              ) : null}
            </Link>
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
}: {
  order: ManufacturingOrderDetail;
  canEdit: boolean;
  onOpenLotPicker: (ingredient: ManufacturingOrderIngredientDetail) => void;
}) {
  const materialCost = order.ingredients.reduce((total, ingredient) => {
    const cost = Number(ingredient.actualCostTotal ?? 0);
    return Number.isFinite(cost) ? total + cost : total;
  }, 0);

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionHeading}>
        Ingredients
        <span className="count">
          {order.ingredients.length} item{order.ingredients.length === 1 ? "" : "s"}
          {materialCost > 0 ? ` · ${formatPrice(String(materialCost))} material cost` : ""}
        </span>
      </h2>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Ingredient</th>
            <th>SKU</th>
            <th className={styles.num}>Planned</th>
            <th className={styles.num}>Picked / Actual</th>
            <th>Lot allocation</th>
            <th className={styles.num}>Cost</th>
            <th>Requirements</th>
          </tr>
        </thead>
        <tbody>
          {order.ingredients.length === 0 ? (
            <tr>
              <td colSpan={7} className="text-center text-[var(--color-muted)]">
                No ingredients on this order.
              </td>
            </tr>
          ) : (
            order.ingredients.map((ingredient) => (
              <IngredientRow
                key={ingredient.id}
                orderId={order.id}
                ingredient={ingredient}
                canEdit={canEdit}
                onOpenLotPicker={() => onOpenLotPicker(ingredient)}
              />
            ))
          )}
        </tbody>
      </table>
    </section>
  );
}

function IngredientRow({
  orderId,
  ingredient,
  canEdit,
  onOpenLotPicker,
}: {
  orderId: string;
  ingredient: ManufacturingOrderIngredientDetail;
  canEdit: boolean;
  onOpenLotPicker: () => void;
}) {
  const summary: PickedLotSummary = {
    count: ingredient.pickedQuantity && Number(ingredient.pickedQuantity) > 0 ? 1 : 0,
    firstLot: null,
    totalQty:
      ingredient.pickedQuantity && Number(ingredient.pickedQuantity) > 0
        ? formatQuantity(ingredient.pickedQuantity)
        : null,
  };

  const requirementChips =
    ingredient.constraints?.map((constraint, index) => (
      <span
        key={index}
        className="mr-1 inline-flex h-5 items-center bg-[var(--color-warning-soft)] px-1.5 text-[10.5px] font-semibold text-[var(--color-warning)]"
      >
        {constraint.constraintType === "lot_age_min_days"
          ? `≥ ${constraint.config.days}d age`
          : constraint.constraintType}
      </span>
    )) ?? null;

  return (
    <tr>
      <td>
        <div className="flex flex-col">
          <span className="text-[13px] font-medium text-[var(--color-ink)]">
            {ingredient.itemName}
          </span>
          {ingredient.itemType ? (
            <span className="text-[11px] text-[var(--color-muted)] capitalize">
              {ingredient.itemType}
            </span>
          ) : null}
        </div>
      </td>
      <td className={styles.sku}>{ingredient.itemSku ?? "—"}</td>
      <td className={styles.num}>
        {formatQuantity(ingredient.plannedQuantity)}
        <span className={styles.uom}>{ingredient.unitName}</span>
      </td>
      <td className={styles.num}>
        <div className="flex flex-col items-end">
          <span>
            {formatQuantity(ingredient.pickedQuantity)} /{" "}
            {ingredient.actualQuantity != null
              ? formatQuantity(ingredient.actualQuantity)
              : "—"}
          </span>
          <span className="text-[11px] text-[var(--color-muted)]">
            of {formatQuantity(ingredient.plannedQuantity)}
          </span>
        </div>
      </td>
      <td>
        {canEdit ? (
          <LotStrategyChip
            orderId={orderId}
            ingredientId={ingredient.id}
            strategy={ingredient.lotStrategy as ManufacturingLotStrategy}
            summary={summary}
            onOpenPicker={onOpenLotPicker}
          />
        ) : (
          <span className="text-[11.5px] text-[var(--color-muted)]">
            {summary.count} lot{summary.count === 1 ? "" : "s"}
          </span>
        )}
      </td>
      <td className={styles.num}>
        {ingredient.actualCostTotal != null
          ? formatPrice(ingredient.actualCostTotal)
          : "—"}
      </td>
      <td>{requirementChips ?? <span className={styles.placeholder}>—</span>}</td>
    </tr>
  );
}

function OperationsSection({ order }: { order: ManufacturingOrderDetail }) {
  if (order.operationCosts.length === 0) {
    return (
      <section className={styles.section}>
        <h2 className={styles.sectionHeading}>Operations</h2>
        <div className="border border-dashed border-[var(--color-line)] p-6 text-center text-[12.5px] text-[var(--color-muted)]">
          No operations for this product.
        </div>
      </section>
    );
  }
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionHeading}>
        Operations
        <span className="count">
          {order.operationCosts.length} step{order.operationCosts.length === 1 ? "" : "s"}
        </span>
      </h2>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Operation step</th>
            <th>Resource</th>
            <th className={styles.num}>Planned time</th>
            <th className={styles.num}>Cost</th>
          </tr>
        </thead>
        <tbody>
          {order.operationCosts.map((operation) => (
            <tr key={operation.id}>
              <td>{operation.operationName}</td>
              <td>{operation.resourceName}</td>
              <td className={styles.num}>
                {formatQuantity(operation.plannedMinutes)}
                <span className={styles.uom}>min</span>
              </td>
              <td className={styles.num}>{formatPrice(operation.plannedCostTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function NotesSection({
  order,
  canEdit,
  onPatched,
}: {
  order: ManufacturingOrderDetail;
  canEdit: boolean;
  onPatched: (notes: string | null) => void;
}) {
  const patchNotes = useMutation({
    mutationKey: ["mo", order.id, "notes"],
    mutationFn: (value: string | null) => patchManufacturingOrder(order.id, { notes: value }),
    onSuccess: (_data, value) => onPatched(value),
  });

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionHeading}>
        Notes
        <span className="hint">internal only</span>
      </h2>
      {canEdit ? (
        <Textarea
          aria-label="Notes"
          defaultValue={order.notes ?? ""}
          onBlur={(event) => {
            const next = event.target.value.trim() || null;
            if (next !== order.notes) patchNotes.mutate(next);
          }}
          rows={3}
          className="min-h-20 border-[var(--color-line)] focus-visible:ring-[var(--color-accent)]"
          placeholder="Notes for this order…"
        />
      ) : (
        <div className="min-h-20 border border-[var(--color-line)] bg-[var(--color-surface-alt)] p-3 text-[13px] text-[var(--color-ink)] whitespace-pre-wrap">
          {order.notes ?? <span className="text-[var(--color-muted)]">No notes.</span>}
        </div>
      )}
    </section>
  );
}
