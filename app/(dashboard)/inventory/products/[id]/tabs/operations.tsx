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
import { CardSection } from "@/components/card-page/card-page";
import { ActiveVariantSelect } from "@/components/card-page/active-variant-select";
import { CopyDialog } from "@/components/card-page/copy-bom-dialog";
import { cardSaveMutationKey } from "@/components/card-page/card-save-status";
import type { BomPayloadRow } from "@/app/(dashboard)/inventory/bom-editor";
import {
  OperationCostEditor,
  type OperationCostPayloadRow,
} from "@/components/card-page/operation-cost-editor";
import {
  saveBomRevision,
  type ItemCardDto,
} from "@/lib/api/clients/item-cards";
import styles from "@/components/card-page/card-page.module.css";

type ManufacturingResourceOption = {
  id: string;
  name: string;
  resourceType: string;
  loadedCostPerHour: string;
};

export type ProductOperationsTabProps = {
  card: ItemCardDto;
  focusItemId: string;
  currentBomRows: BomPayloadRow[];
  currentBomOutputQuantity: string;
  currentRecipeBasis: "unit" | "batch";
  initialOperationCosts: OperationCostPayloadRow[];
  resources: ManufacturingResourceOption[];
  expectedBatchYield?: string | null;
  typicalBatchSize?: string | null;
  standardCostQuantity?: string | null;
};

function isBlankOperationCost(row: OperationCostPayloadRow) {
  const operationName = row.operationName?.trim() ?? "";
  const resourceId = row.resourceId?.trim() ?? "";
  const crewSize = row.crewSize?.trim() ?? "";
  const plannedMinutes = row.plannedMinutes?.trim() ?? "";
  return operationName === "" && resourceId === "" && crewSize === "" && plannedMinutes === "";
}

export function ProductOperationsTab({
  card,
  focusItemId,
  currentBomRows,
  currentBomOutputQuantity,
  currentRecipeBasis,
  initialOperationCosts,
  resources,
  expectedBatchYield,
  typicalBatchSize,
  standardCostQuantity,
}: ProductOperationsTabProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const visibleVariants = card.variants.filter((variant) => variant.deletedAt == null);
  const activeVariant =
    visibleVariants.find((variant) => variant.id === focusItemId) ?? visibleVariants[0] ?? null;
  const [rows, setRows] = useState<OperationCostPayloadRow[]>(initialOperationCosts);
  const [dirty, setDirty] = useState(false);
  const [copyToOpen, setCopyToOpen] = useState(false);
  const [copyFromOpen, setCopyFromOpen] = useState(false);

  const saveMutation = useMutation({
    mutationKey: cardSaveMutationKey("item-card", focusItemId, "operation-costs"),
    mutationFn: () =>
      saveBomRevision(focusItemId, {
        outputQuantity: currentBomOutputQuantity,
        recipeBasis: currentRecipeBasis,
        expectedBatchYield: currentRecipeBasis === "batch" ? expectedBatchYield : null,
        bom: currentBomRows
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
        operationCosts: rows
          .filter((row) => !isBlankOperationCost(row))
          .map((row) => ({
            operationName: row.operationName!.trim(),
            resourceId: row.resourceId!.trim(),
            costScalingMode: row.costScalingMode ?? "per_output_unit",
            crewSize: row.crewSize!,
            plannedMinutes: row.plannedMinutes!,
            loadedCostPerHour: row.loadedCostPerHour ?? null,
          })),
        note: null,
      }),
    onSuccess: () => {
      setDirty(false);
      void queryClient.invalidateQueries({ queryKey: ["item-card"] });
      router.refresh();
    },
  });

  const handleVariantChange = (nextVariantId: string) => {
    if (nextVariantId === focusItemId) return;
    if (dirty) {
      const confirmed = window.confirm(
        "You have unsaved production changes. Discard them and switch variants?",
      );
      if (!confirmed) return;
    }
    router.push(`/inventory/products/${nextVariantId}/production`);
  };

  return (
    <CardSection title="Production">
      <div className="flex flex-col gap-(--space-3) md:flex-row md:items-end md:justify-between">
        <ActiveVariantSelect
          variants={visibleVariants}
          value={focusItemId}
          onChange={handleVariantChange}
          hideWhenSingle={false}
        />
        <div className="flex shrink-0 flex-nowrap items-center justify-end gap-(--space-1) overflow-x-auto">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="px-(--space-4)"
            onClick={() => setCopyToOpen(true)}
            disabled={!activeVariant || visibleVariants.length < 2}
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
            disabled={!activeVariant}
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
                setRows(initialOperationCosts);
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
            disabled={!activeVariant || !dirty || saveMutation.isPending}
          >
            <HugeiconsIcon icon={CheckmarkCircle02Icon} data-icon="inline-start" />
            {saveMutation.isPending ? "Saving…" : "Save production"}
          </Button>
        </div>
      </div>

      <p
        className={styles.helper}
        style={{ marginTop: "var(--space-2)", marginBottom: "var(--space-3)" }}
      >
        {activeVariant ? (
          <>
            Any changes made here only affect <strong>{activeVariant.displayName}</strong>.
          </>
        ) : (
          "No variants yet. Production operations will be available after the first variant exists."
        )}
      </p>

      <OperationCostEditor
        initialRows={initialOperationCosts}
        resources={resources}
        expectedBatchYield={expectedBatchYield}
        typicalBatchSize={typicalBatchSize}
        standardCostQuantity={standardCostQuantity}
        error={saveMutation.error}
        onRowsChange={(nextRows, meta) => {
          if (!activeVariant) return;
          setRows(nextRows);
          setDirty(meta.dirty);
        }}
      />

      {activeVariant ? (
        <>
          <CopyDialog
            open={copyToOpen}
            onOpenChange={setCopyToOpen}
            cardItemId={focusItemId}
            scope="operations"
            direction="to"
            activeVariant={activeVariant}
            siblings={visibleVariants}
          />
          <CopyDialog
            open={copyFromOpen}
            onOpenChange={setCopyFromOpen}
            cardItemId={focusItemId}
            scope="operations"
            direction="from"
            activeVariant={activeVariant}
            siblings={visibleVariants}
          />
        </>
      ) : null}
    </CardSection>
  );
}
