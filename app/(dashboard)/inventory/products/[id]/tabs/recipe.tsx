"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { ActiveVariantSelect } from "@/components/card-page/active-variant-select";
import { CopyDialog } from "@/components/card-page/copy-bom-dialog";
import { BomEditor, type BomPayloadRow } from "@/app/(dashboard)/inventory/bom-editor";
import {
  saveBomRevision,
  type ItemCardDto,
} from "@/lib/api/clients/item-cards";
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
  availableComponents: AvailableComponent[];
  canViewBom: boolean;
};

export function ProductRecipeTab({
  card,
  focusItemId,
  initialBomRows,
  availableComponents,
  canViewBom,
}: ProductRecipeTabProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const visibleVariants = card.variants.filter((variant) => variant.deletedAt == null);
  const activeVariant =
    visibleVariants.find((variant) => variant.id === focusItemId) ?? visibleVariants[0];

  const [rows, setRows] = useState<BomPayloadRow[]>(initialBomRows);
  const [dirty, setDirty] = useState(false);
  const [copyToOpen, setCopyToOpen] = useState(false);
  const [copyFromOpen, setCopyFromOpen] = useState(false);

  const saveMutation = useMutation({
    mutationKey: ["item-card", focusItemId, "bom-revision"],
    mutationFn: () =>
      saveBomRevision(focusItemId, {
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
            consumptionMode: row.consumptionMode ?? null,
            basisOutputQuantity: row.basisOutputQuantity ?? null,
            batchScalingMode: row.batchScalingMode ?? null,
            groupRemainderPolicy: row.groupRemainderPolicy ?? null,
            minimumLotAgeDays: row.minimumLotAgeDays ?? null,
            alternates: row.alternates ?? [],
          })),
        note: null,
      }),
    onSuccess: () => {
      setDirty(false);
      void queryClient.invalidateQueries({ queryKey: ["item-card"] });
      // Refetch the server-side BOM rows so the editor shows the saved state.
      router.refresh();
    },
  });

  if (!canViewBom) {
    return (
      <section className={styles.section}>
        <p className={styles.helper}>
          You don&apos;t have access to view this recipe.
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
    router.push(`/inventory/${segment}/${nextVariantId}?view=card&tab=recipe`);
  };

  const handleRowsChange = (next: BomPayloadRow[]) => {
    setRows(next);
    setDirty(true);
  };

  const errorMessage = saveMutation.error
    ? (saveMutation.error as Error).message
    : null;

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionHeading}>
        Ingredients
        <span className={styles.hint}>per 1 unit of product</span>
      </h2>

      <div className="flex flex-col gap-(--space-3) md:flex-row md:items-end md:justify-between">
        <ActiveVariantSelect
          variants={visibleVariants}
          value={focusItemId}
          onChange={handleVariantChange}
          hideWhenSingle={false}
        />
        <div className="flex flex-wrap items-center gap-(--space-2)">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setCopyToOpen(true)}
            disabled={visibleVariants.length < 2}
          >
            Copy to…
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setCopyFromOpen(true)}
            disabled={visibleVariants.length < 2}
          >
            Copy from…
          </Button>
          {dirty ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setRows(initialBomRows);
                setDirty(false);
              }}
              disabled={saveMutation.isPending}
            >
              Discard
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            onClick={() => saveMutation.mutate()}
            disabled={!dirty || saveMutation.isPending}
          >
            {saveMutation.isPending ? "Saving…" : "Save recipe"}
          </Button>
        </div>
      </div>

      <p
        className={styles.helper}
        style={{ marginTop: "var(--space-2)", marginBottom: "var(--space-3)" }}
      >
        Any changes made here only affect <strong>{activeVariant.displayName}</strong>.
      </p>

      <BomEditor
        initialRows={initialBomRows}
        availableComponents={availableComponents}
        onRowsChange={(nextRows) => handleRowsChange(nextRows)}
        error={errorMessage}
      />

      <CopyDialog
        open={copyToOpen}
        onOpenChange={setCopyToOpen}
        scope="bom"
        direction="to"
        activeVariant={activeVariant}
        siblings={visibleVariants}
      />
      <CopyDialog
        open={copyFromOpen}
        onOpenChange={setCopyFromOpen}
        scope="bom"
        direction="from"
        activeVariant={activeVariant}
        siblings={visibleVariants}
      />
    </section>
  );
}
