"use client";

import { useState } from "react";
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
import { Delete02Icon, Add01Icon } from "@hugeicons/core-free-icons";
import {
  deleteVariant,
  updateItemCardVariant,
  type ItemCardDto,
  type ItemCardVariantDto,
  type UpdateItemCardVariantInput,
  type VariantOptionDto,
} from "@/lib/api/clients/item-cards";
import { cn } from "@/lib/utils";
import styles from "./card-page.module.css";

type EditableTextField = "sku" | "registeredBarcode" | "internalBarcode" | "supplierItemCode";
type EditableNumberField = "defaultLeadTimeDays" | "minimumOrderQuantity";

export type VariantTableProps = {
  /** The card being viewed. Used to derive options + variants + family. */
  card: ItemCardDto;
  /** Which set of columns to render — products show pricing-ish, materials show supplier. */
  viewMode: "product" | "material";
  /** Called when the user clicks "Add initial stock" on a row. */
  onAddInitialStock?: (variant: ItemCardVariantDto) => void;
  /** Whether the Add initial stock endpoint is available; if not, button disables with tooltip. */
  addInitialStockEndpointReady?: boolean;
};

export function VariantTable({
  card,
  viewMode,
  onAddInitialStock,
  addInitialStockEndpointReady = false,
}: VariantTableProps) {
  const activeOptions = card.options.filter((option) => option.disabledAt == null);
  const variants = card.variants.filter((variant) => variant.deletedAt == null);

  if (variants.length === 0) {
    return (
      <p className="text-[length:var(--text-sm)] text-muted-foreground py-(--space-4)">
        No variants yet. Open configuration to add some.
      </p>
    );
  }

  return (
    <table className={styles.table}>
      <thead>
        <tr>
          {activeOptions.map((option) => (
            <th key={option.id}>{option.name}</th>
          ))}
          <th>Variant code/SKU</th>
          {viewMode === "product" ? (
            <th className={styles.num}>Default sales price</th>
          ) : null}
          <th>Registered barcode</th>
          <th>Internal barcode</th>
          {viewMode === "product" ? (
            <>
              <th className={styles.num}>Ingredients cost</th>
              <th className={styles.num}>Operations cost</th>
            </>
          ) : null}
          {viewMode === "material" ? (
            <>
              <th>Supplier item code</th>
              <th className={styles.num}>Lead time</th>
              <th className={styles.num}>MOQ</th>
            </>
          ) : null}
          <th className={styles.num}>In stock</th>
          <th className={styles.colAct}></th>
          <th className={styles.colAct}></th>
        </tr>
      </thead>
      <tbody>
        {variants.map((variant) => (
          <VariantRow
            key={variant.id}
            variant={variant}
            activeOptions={activeOptions}
            viewMode={viewMode}
            onAddInitialStock={onAddInitialStock}
            addInitialStockEndpointReady={addInitialStockEndpointReady}
          />
        ))}
      </tbody>
    </table>
  );
}

type VariantRowProps = {
  variant: ItemCardVariantDto;
  activeOptions: VariantOptionDto[];
  viewMode: "product" | "material";
  onAddInitialStock?: (variant: ItemCardVariantDto) => void;
  addInitialStockEndpointReady?: boolean;
};

function VariantRow({
  variant,
  activeOptions,
  viewMode,
  onAddInitialStock,
  addInitialStockEndpointReady,
}: VariantRowProps) {
  const valueByOption = new Map(
    variant.optionValues.map((value) => [value.optionId, value]),
  );
  const [confirmDelete, setConfirmDelete] = useState(false);
  const queryClient = useQueryClient();

  const deleteMutation = useMutation({
    mutationKey: ["item-card", variant.id, "delete"],
    mutationFn: () => deleteVariant(variant.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["item-card", variant.familyId] });
      void queryClient.invalidateQueries({ queryKey: ["item-cards"] });
    },
  });

  return (
    <>
      <tr className={cn(variant.deletedAt && styles.chipDisabled)}>
        {activeOptions.map((option) => {
          const assigned = valueByOption.get(option.id);
          return (
            <td key={option.id}>
              {assigned ? (
                <span
                  className={cn(
                    styles.sizePill,
                    assigned.valueDisabledAt && styles.chipDisabled,
                  )}
                >
                  {assigned.valueLabel}
                </span>
              ) : (
                <span className={styles.placeholder}>—</span>
              )}
            </td>
          );
        })}
        <EditableTextCell
          variantId={variant.id}
          field="sku"
          value={variant.sku}
          placeholder="E.g. P-1, M-1"
        />
        {viewMode === "product" ? (
          <td className={styles.num}>
            <span className={styles.placeholder}>—</span>
            <span className={styles.uom}>USD</span>
          </td>
        ) : null}
        <EditableTextCell
          variantId={variant.id}
          field="registeredBarcode"
          value={variant.registeredBarcode}
          placeholder="—"
        />
        <EditableTextCell
          variantId={variant.id}
          field="internalBarcode"
          value={variant.internalBarcode}
          placeholder="—"
        />
        {viewMode === "product" ? (
          <>
            <td className={styles.num}>
              <span className={styles.placeholder}>—</span>
              <span className={styles.uom}>USD</span>
            </td>
            <td className={styles.num}>
              <span className={styles.placeholder}>—</span>
              <span className={styles.uom}>USD</span>
            </td>
          </>
        ) : null}
        {viewMode === "material" ? (
          <>
            <EditableTextCell
              variantId={variant.id}
              field="supplierItemCode"
              value={variant.supplierItemCode}
              placeholder="—"
            />
            <EditableNumberCell
              variantId={variant.id}
              field="defaultLeadTimeDays"
              value={
                variant.defaultLeadTimeDays != null
                  ? String(variant.defaultLeadTimeDays)
                  : null
              }
              placeholder="—"
              integer
            />
            <EditableNumberCell
              variantId={variant.id}
              field="minimumOrderQuantity"
              value={variant.minimumOrderQuantity}
              placeholder="—"
            />
          </>
        ) : null}
        <td className={styles.num}>
          {/* In stock — backend DTO doesn't expose lot balances yet. When ready,
              render a mono number (red if negative) or the "Add initial stock"
              link if zero. Until then: clickable "Add initial stock" link. */}
          {onAddInitialStock ? (
            <StockCellLink
              ready={addInitialStockEndpointReady}
              onClick={() => onAddInitialStock(variant)}
            />
          ) : (
            <span className={styles.placeholder}>—</span>
          )}
        </td>
        <td className={styles.colAct}>
          {onAddInitialStock ? (
            <AddInitialStockButton
              ready={addInitialStockEndpointReady}
              onClick={() => onAddInitialStock(variant)}
            />
          ) : null}
        </td>
        <td className={styles.colAct}>
          <button
            type="button"
            className={cn(styles.iButton, styles.iButtonDanger)}
            aria-label="Delete variant"
            onClick={() => setConfirmDelete(true)}
            disabled={deleteMutation.isPending}
          >
            <HugeiconsIcon icon={Delete02Icon} size={14} />
          </button>
        </td>
      </tr>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete variant?</AlertDialogTitle>
            <AlertDialogDescription>
              {variant.displayName} will be removed from this card.
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
                deleteMutation.mutate(undefined, {
                  onSuccess: () => setConfirmDelete(false),
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

function useTextVariantMutation(variantId: string, field: EditableTextField) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["item-card", variantId, "patch", field] as const,
    mutationFn: (next: string | null) =>
      updateItemCardVariant(variantId, { [field]: next } satisfies UpdateItemCardVariantInput),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["item-card"] });
    },
  });
}

function useNumberVariantMutation(variantId: string, field: EditableNumberField) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["item-card", variantId, "patch", field] as const,
    mutationFn: (next: number | string | null) => {
      const payload: UpdateItemCardVariantInput =
        field === "defaultLeadTimeDays"
          ? { defaultLeadTimeDays: next == null ? null : Number(next) }
          : { minimumOrderQuantity: next == null ? null : String(next) };
      return updateItemCardVariant(variantId, payload);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["item-card"] });
    },
  });
}

type EditableTextCellProps = {
  variantId: string;
  field: EditableTextField;
  value: string | null;
  placeholder?: string;
};

function EditableTextCell({ variantId, field, value, placeholder }: EditableTextCellProps) {
  const remote = value ?? "";
  const [draft, setDraft] = useState(remote);
  const [lastSyncedRemote, setLastSyncedRemote] = useState(remote);
  // Sync local draft when the server value changes (e.g. after invalidate).
  // We use a remembered "lastSynced" so a typed-but-not-blurred edit isn't
  // clobbered the moment its own save resolves.
  if (remote !== lastSyncedRemote) {
    setLastSyncedRemote(remote);
    setDraft(remote);
  }
  const mutation = useTextVariantMutation(variantId, field);

  return (
    <td>
      <input
        type="text"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          const trimmed = draft.trim();
          const next = trimmed === "" ? null : trimmed;
          const current = value ?? null;
          if (next === current) return;
          mutation.mutate(next);
        }}
        placeholder={placeholder}
        aria-invalid={mutation.isError || undefined}
        className={cn(styles.cellInput, isMonoField(field) && styles.mono)}
      />
    </td>
  );
}

type EditableNumberCellProps = {
  variantId: string;
  field: EditableNumberField;
  value: string | null;
  placeholder?: string;
  integer?: boolean;
};

function EditableNumberCell({
  variantId,
  field,
  value,
  placeholder,
  integer,
}: EditableNumberCellProps) {
  const remote = value ?? "";
  const [draft, setDraft] = useState(remote);
  const [lastSyncedRemote, setLastSyncedRemote] = useState(remote);
  if (remote !== lastSyncedRemote) {
    setLastSyncedRemote(remote);
    setDraft(remote);
  }
  const mutation = useNumberVariantMutation(variantId, field);

  return (
    <td className={styles.num}>
      <input
        type="text"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          const trimmed = draft.trim();
          if (trimmed === "") {
            if (value != null) mutation.mutate(null);
            return;
          }
          const parsed = Number(trimmed);
          if (!Number.isFinite(parsed) || parsed < 0) {
            setDraft(value ?? "");
            return;
          }
          const next = integer ? String(Math.trunc(parsed)) : trimmed;
          if (next === (value ?? "")) return;
          mutation.mutate(integer ? Math.trunc(parsed) : next);
        }}
        placeholder={placeholder}
        inputMode={integer ? "numeric" : "decimal"}
        aria-invalid={mutation.isError || undefined}
        className={cn(styles.cellInput, styles.mono)}
        style={{ textAlign: "right" }}
      />
    </td>
  );
}

function isMonoField(field: EditableTextField): boolean {
  // Mono on machine identifiers and numerics
  return (
    field === "sku" ||
    field === "registeredBarcode" ||
    field === "internalBarcode" ||
    field === "supplierItemCode"
  );
}

// TODO(card-dto): When Codex extends ItemCardDto with defaultSellingPrice,
// defaultPurchasePrice, currentStockUnitCost, safetyStock, stock-on-hand,
// ingredientsCost, operationsCost on each variant, render those columns here.
// The PATCH /api/item-cards/:variantId already accepts these fields; only
// the READ side needs extending.
