"use client";

import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CheckmarkCircle02Icon,
  Download01Icon,
  Undo03Icon,
  Upload01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { CardSection } from "@/components/card-page/card-page";
import { ActiveVariantSelect } from "@/components/card-page/active-variant-select";
import { CopyDialog } from "@/components/card-page/copy-bom-dialog";
import { cardSaveMutationKey } from "@/components/card-page/card-save-status";
import { useItemCardContext } from "@/components/card-page/item-card-focus-context";
import {
  toBomRevisionPayloadRows,
  type BomPayloadRow,
} from "@/app/(dashboard)/inventory/bom-editor";
import {
  OperationCostEditor,
  type OperationCostPayloadRow,
} from "@/components/card-page/operation-cost-editor";
import {
  getProductProductionTabPayload,
  saveBomRevision,
  type ProductProductionTabPayload,
} from "@/lib/api/clients/item-cards";
import { pushCardUrlWithoutNavigation } from "@/lib/routing/reflect-card-url";
import styles from "@/components/card-page/card-page.module.css";

type ManufacturingResourceOption = {
  id: string;
  name: string;
  resourceType: string;
  loadedCostPerHour: string;
};

export type ProductOperationsTabProps = {
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
  const queryClient = useQueryClient();
  const itemCard = useItemCardContext();
  const card = itemCard.card;
  const visibleVariants = useMemo(
    () => card.variants.filter((variant) => variant.deletedAt == null),
    [card.variants],
  );
  const activeFocusItemId = itemCard.focusedItemId ?? focusItemId;
  const activeVariant =
    visibleVariants.find((variant) => variant.id === activeFocusItemId) ??
    visibleVariants[0] ??
    null;
  const initialPayload: ProductProductionTabPayload = {
    focusItemId,
    currentBomRows,
    currentBomOutputQuantity,
    currentRecipeBasis,
    initialOperationCosts,
    resources,
    expectedBatchYield: expectedBatchYield ?? null,
    typicalBatchSize: typicalBatchSize ?? null,
    standardCostQuantity: standardCostQuantity ?? null,
  };
  const [productionData, setProductionData] =
    useState<ProductProductionTabPayload>(initialPayload);
  const [loadingVariantId, setLoadingVariantId] = useState<string | null>(null);
  const [rows, setRows] = useState<OperationCostPayloadRow[]>(initialOperationCosts);
  const [dirty, setDirty] = useState(false);
  const [copyToOpen, setCopyToOpen] = useState(false);
  const [copyFromOpen, setCopyFromOpen] = useState(false);
  const tabLoading = loadingVariantId === activeFocusItemId;

  const loadProductionPayload = (variantId: string) =>
    queryClient.fetchQuery({
      queryKey: ["product-production-tab", variantId],
      queryFn: () => getProductProductionTabPayload(variantId),
      staleTime: Infinity,
    });

  const saveMutation = useMutation({
    mutationKey: cardSaveMutationKey("item-card", activeFocusItemId, "operation-costs"),
    mutationFn: () =>
      saveBomRevision(activeFocusItemId, {
        outputQuantity: productionData.currentBomOutputQuantity,
        recipeBasis: productionData.currentRecipeBasis,
        expectedBatchYield:
          productionData.currentRecipeBasis === "batch"
            ? productionData.expectedBatchYield
            : null,
        bom: toBomRevisionPayloadRows(productionData.currentBomRows),
        operationCosts: rows
          .filter((row) => !isBlankOperationCost(row))
          .map((row) => ({
            operationName: row.operationName!.trim(),
            resourceId: row.resourceId!.trim(),
            costScalingMode: "per_output_unit",
            crewSize: row.crewSize!,
            plannedMinutes: row.plannedMinutes!,
            loadedCostPerHour: row.loadedCostPerHour ?? null,
          })),
        note: null,
      }),
    onSuccess: () => {
      setDirty(false);
      void (async () => {
        const nextData = await getProductProductionTabPayload(activeFocusItemId);
        queryClient.setQueryData(["product-production-tab", activeFocusItemId], nextData);
        setProductionData(nextData);
        setRows(nextData.initialOperationCosts);
        await queryClient.invalidateQueries({ queryKey: ["item-card"] });
      })();
    },
  });

  const handleVariantChange = async (nextVariantId: string) => {
    if (nextVariantId === activeFocusItemId) return;
    if (dirty) {
      const confirmed = window.confirm(
        "You have unsaved production changes. Discard them and switch variants?",
      );
      if (!confirmed) return;
    }
    setDirty(false);
    setLoadingVariantId(nextVariantId);
    itemCard.setFocusedItemId(nextVariantId);
    pushCardUrlWithoutNavigation(
      `/inventory/products/${focusItemId}/production?variant=${encodeURIComponent(nextVariantId)}`,
    );
    try {
      const nextData = await loadProductionPayload(nextVariantId);
      setProductionData(nextData);
      setRows(nextData.initialOperationCosts);
      setCopyToOpen(false);
      setCopyFromOpen(false);
    } finally {
      setLoadingVariantId(null);
    }
  };

  return (
    <CardSection title="Production">
      <div className="flex flex-col gap-(--space-3) md:flex-row md:items-end md:justify-between">
        <ActiveVariantSelect
          variants={visibleVariants}
          value={activeFocusItemId}
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
            disabled={tabLoading || !activeVariant || visibleVariants.length < 2}
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
            disabled={tabLoading || !activeVariant}
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
                setRows(productionData?.initialOperationCosts ?? initialOperationCosts);
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
            disabled={tabLoading || !activeVariant || !dirty || saveMutation.isPending}
          >
            <HugeiconsIcon icon={CheckmarkCircle02Icon} data-icon="inline-start" />
            {saveMutation.isPending ? "Saving…" : "Save production"}
          </Button>
        </div>
      </div>

      <p className={`${styles.helper} mt-(--space-2) mb-(--space-3)`}>
        {activeVariant ? (
          <>
            Any changes made here only affect <strong>{activeVariant.displayName}</strong>.
          </>
        ) : (
          "No variants yet. Production operations will be available after the first variant exists."
        )}
      </p>

      {tabLoading ? (
        <div className="flex min-h-[220px] items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface-alt)]">
          <Spinner className="size-5" />
        </div>
      ) : (
        <OperationCostEditor
          key={`${activeFocusItemId}:${productionData.initialOperationCosts.length}`}
          initialRows={productionData.initialOperationCosts}
          resources={productionData.resources}
          error={saveMutation.error}
          onRowsChange={(nextRows, meta) => {
            if (!activeVariant) return;
            setRows(nextRows);
            setDirty(meta.dirty);
          }}
        />
      )}

      {activeVariant && productionData ? (
        <>
          <CopyDialog
            open={copyToOpen}
            onOpenChange={setCopyToOpen}
            cardItemId={activeFocusItemId}
            scope="operations"
            direction="to"
            activeVariant={activeVariant}
            siblings={visibleVariants}
          />
          <CopyDialog
            open={copyFromOpen}
            onOpenChange={setCopyFromOpen}
            cardItemId={activeFocusItemId}
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
