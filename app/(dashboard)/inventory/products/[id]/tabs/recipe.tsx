"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CheckmarkCircle02Icon,
  Download01Icon,
  Undo03Icon,
  Upload01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ActiveVariantSelect } from "@/components/card-page/active-variant-select";
import { CopyDialog } from "@/components/card-page/copy-bom-dialog";
import { cardSaveMutationKey } from "@/components/card-page/card-save-status";
import { BomEditor, type BomPayloadRow } from "@/app/(dashboard)/inventory/bom-editor";
import { saveBomRevision, type ItemCardDto } from "@/lib/api/clients/item-cards";
import styles from "@/components/card-page/card-page.module.css";

type AvailableComponent = {
  id: string;
  name: string;
  displayName: string;
  itemType: string;
  unit: string;
};

export type ProductRecipeTabProps = {
  card: ItemCardDto;
  focusItemId: string;
  initialBomRows: BomPayloadRow[];
  initialOutputQuantity: string;
  initialRecipeBasis: "unit" | "batch";
  initialExpectedBatchYield: string | null;
  availableComponents: AvailableComponent[];
  canViewBom: boolean;
  canEditProduct: boolean;
};

export function ProductRecipeTab({
  card,
  focusItemId,
  initialBomRows,
  initialOutputQuantity,
  initialRecipeBasis,
  initialExpectedBatchYield,
  availableComponents,
  canViewBom,
  canEditProduct,
}: ProductRecipeTabProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const visibleVariants = card.variants.filter((variant) => variant.deletedAt == null);
  const activeVariant =
    visibleVariants.find((variant) => variant.id === focusItemId) ?? visibleVariants[0];

  const [rows, setRows] = useState<BomPayloadRow[]>(initialBomRows);
  const [recipeBasis, setRecipeBasis] = useState<"unit" | "batch">(
    initialRecipeBasis,
  );
  const [expectedBatchYield, setExpectedBatchYield] = useState(
    initialExpectedBatchYield ?? initialOutputQuantity,
  );
  const [dirty, setDirty] = useState(false);
  const [copyToOpen, setCopyToOpen] = useState(false);
  const [copyFromOpen, setCopyFromOpen] = useState(false);

  const saveMutation = useMutation({
    mutationKey: cardSaveMutationKey("item-card", focusItemId, "bom-revision"),
    mutationFn: () =>
      saveBomRevision(focusItemId, {
        recipeBasis,
        expectedBatchYield: recipeBasis === "batch" ? expectedBatchYield : null,
        outputQuantity: recipeBasis === "batch" ? expectedBatchYield : "1",
        bom: rows
          .filter(
            (row) =>
              row.componentId &&
              row.componentId.trim() !== "" &&
              row.quantity != null &&
              row.quantity.trim() !== "",
          )
          .map((row) => ({
            componentId: row.componentId!,
            quantity: row.quantity!,
            minimumLotAgeDays: row.minimumLotAgeDays ?? null,
            alternates: row.alternates ?? [],
          })),
        note: null,
      }),
    onSuccess: () => {
      setDirty(false);
      void queryClient.invalidateQueries({ queryKey: ["item-card"] });
      router.refresh();
    },
  });

  if (!canViewBom) {
    return (
      <section className={styles.section} aria-label="Locked recipe">
        <p className={styles.helper}>
          This recipe is locked. Inventory or manufacturing admin access is required
          to view or edit recipe details.
        </p>
      </section>
    );
  }

  if (!activeVariant) {
    return (
      <section className={styles.section}>
        <p className={styles.helper}>
          Generate at least one variant from the Variant configuration dialog before editing a recipe.
        </p>
      </section>
    );
  }

  const handleVariantChange = (nextVariantId: string) => {
    if (nextVariantId === focusItemId) return;
    if (dirty) {
      const confirmed = window.confirm(
        "You have unsaved recipe changes. Discard them and switch variants?",
      );
      if (!confirmed) return;
    }
    const segment = card.family.itemType === "material" ? "materials" : "products";
    router.push(`/inventory/${segment}/${nextVariantId}/recipe`);
  };

  const handleRowsChange = (next: BomPayloadRow[]) => {
    if (!canEditProduct) return;
    setRows(next);
    setDirty(true);
  };

  const errorMessage = saveMutation.error ? (saveMutation.error as Error).message : null;

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionHeading}>
        Recipe / Bill of Materials
        <span className={styles.hint}>
          {recipeBasis === "batch" ? "per 1 production batch" : "per 1 unit of product"}
        </span>
      </h2>

      <div className="flex flex-col gap-(--space-3) md:flex-row md:items-end md:justify-between">
        <ActiveVariantSelect
          variants={visibleVariants}
          value={focusItemId}
          onChange={handleVariantChange}
          hideWhenSingle={false}
        />
        {canEditProduct ? (
          <div className="flex shrink-0 flex-nowrap items-center justify-end gap-(--space-1) overflow-x-auto">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="px-(--space-4)"
              onClick={() => setCopyToOpen(true)}
              disabled={visibleVariants.length < 2}
            >
              <HugeiconsIcon icon={Upload01Icon} data-icon="inline-start" />
              Copy to…
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="px-(--space-4)"
              onClick={() => setCopyFromOpen(true)}
              disabled={visibleVariants.length < 2}
            >
              <HugeiconsIcon icon={Download01Icon} data-icon="inline-start" />
              Copy from…
            </Button>
            {dirty ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="px-(--space-4)"
                onClick={() => {
                  setRows(initialBomRows);
                  setRecipeBasis(initialRecipeBasis);
                  setExpectedBatchYield(initialExpectedBatchYield ?? initialOutputQuantity);
                  setDirty(false);
                }}
                disabled={saveMutation.isPending}
              >
                <HugeiconsIcon icon={Undo03Icon} data-icon="inline-start" />
                Discard
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              className="px-(--space-4)"
              onClick={() => saveMutation.mutate()}
              disabled={!dirty || saveMutation.isPending}
            >
              <HugeiconsIcon icon={CheckmarkCircle02Icon} data-icon="inline-start" />
              {saveMutation.isPending ? "Saving…" : "Save recipe"}
            </Button>
          </div>
        ) : null}
      </div>

      <p
        className={styles.helper}
        style={{ marginTop: "var(--space-2)", marginBottom: "var(--space-3)" }}
      >
        Any changes made here only affect <strong>{activeVariant.displayName}</strong>.
      </p>

      <div className="mb-(--space-4) space-y-(--space-3)">
        <div className="flex items-start gap-(--space-3)">
          <Checkbox
            id="recipe-basis-batch"
            checked={recipeBasis === "batch"}
            onCheckedChange={(checked) => {
              if (!canEditProduct) return;
              setRecipeBasis(checked === true ? "batch" : "unit");
              setDirty(true);
            }}
          />
          <div className="min-w-0 space-y-(--space-1)">
            <Label htmlFor="recipe-basis-batch">
              This product is produced in batches
            </Label>
            <p className="text-[length:var(--text-sm)] text-muted-foreground">
              {recipeBasis === "batch"
                ? "Use the recipe to define what is added for 1 production batch, such as one mixer run. You'll also enter the expected output from that batch."
                : "Use the recipe to define what is needed for 1 unit of finished product."}
            </p>
          </div>
        </div>

        <div className="text-[length:var(--text-sm)] font-medium">
          Recipe basis: {recipeBasis === "batch" ? "Per 1 batch" : "Per 1 unit"}
        </div>

        {recipeBasis === "batch" ? (
          <div className="grid max-w-sm grid-cols-[1fr_auto] items-center gap-(--space-2)">
            <Input
              aria-label="Expected output per batch"
              inputMode="decimal"
              value={expectedBatchYield}
              onChange={(event) => {
                setExpectedBatchYield(event.target.value);
                setDirty(true);
              }}
              disabled={!canEditProduct}
            />
            <span className="text-[length:var(--text-sm)] text-muted-foreground">
              {card.family.unitName ?? "units"}
            </span>
          </div>
        ) : null}
      </div>

      <BomEditor
        initialRows={initialBomRows}
        availableComponents={availableComponents}
        quantityHeader={
          recipeBasis === "batch" ? "Quantity per batch" : "Quantity per unit"
        }
        onRowsChange={handleRowsChange}
        error={errorMessage}
      />

      <div className={styles.totals}>
        <span className={styles.lab}>Total cost</span>
        <span>
          <span className={styles.val}>
            {activeVariant.ingredientsCost == null
              ? "—"
              : Number(activeVariant.ingredientsCost).toFixed(5)}
          </span>
          <span className={styles.ccy}>USD</span>
        </span>
      </div>

      <CopyDialog
        open={copyToOpen}
        onOpenChange={setCopyToOpen}
        cardItemId={focusItemId}
        scope="bom"
        direction="to"
        activeVariant={activeVariant}
        siblings={visibleVariants}
      />
      <CopyDialog
        open={copyFromOpen}
        onOpenChange={setCopyFromOpen}
        cardItemId={focusItemId}
        scope="bom"
        direction="from"
        activeVariant={activeVariant}
        siblings={visibleVariants}
      />
    </section>
  );
}
