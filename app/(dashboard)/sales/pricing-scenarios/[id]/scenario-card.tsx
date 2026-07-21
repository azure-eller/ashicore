"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Alert02Icon,
  Cancel01Icon,
  GitCommitIcon,
} from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  CardPage,
  CardPageBody,
  CardSection,
} from "@/components/card-page/card-page";
import { CardPageHeader } from "@/components/card-page/card-page-header";
import { CardField } from "@/components/card-page/card-field";
import {
  CardFormRow,
  underlineControlClass,
} from "@/components/card-page/form-cell";
import { CommitInput } from "@/components/card-page/commit-input";
import { useCardEntityActions } from "@/components/card-page/use-card-entity-actions";
import { type CardSaveState } from "@/components/card-page/card-save-status";
import { EmptyState } from "@/components/empty-state";
import { ListFrame, SelectableListFrameItem } from "@/components/list-frame";
import {
  InventoryItemCombobox,
  type InventoryItemComboboxOption,
} from "@/components/inventory-item-combobox";
import { useCardKernel } from "@/lib/card-kernel/use-card-kernel";
import { fieldErrorAt } from "@/lib/api/field-errors";
import { reflectPersistedCardUrlWithoutNavigation } from "@/lib/routing/reflect-card-url";
import { formatDate, formatPrice, toDateOnlyString } from "@/lib/format";
import { queryKeys } from "@/lib/client/query-keys";
import {
  commitPricingScenarioRevisionDoc,
  createPricingScenarioDoc,
  deletePricingScenario,
  duplicatePricingScenarioDoc,
  getPricingScenarioDetailData,
  getPricingScenarioRevisionData,
  updatePricingScenarioDoc,
  type PricingScenarioDetailData,
  type PricingScenarioRevisionItem,
} from "@/lib/api/clients/pricing-scenarios";
import {
  calculatePricingScenario,
  type PricingBaseline,
  type PricingUsageTermsDto,
} from "@/lib/pricing-scenarios/calculations";
import {
  updatePricingScenarioSchema,
  type PricingScenarioDoc,
  type PricingScenarioMaterialOverride,
  type PricingScenarioProductValues,
  type PricingScenarioResourceRateOverride,
  type PricingScenarioRevisionSnapshot,
  type UpdatePricingScenario,
} from "@/lib/schemas/pricing-scenarios";

type ScenarioCardDoc = {
  id: string;
  name: string;
  version: number;
  productIds: string[];
  materials: PricingScenarioMaterialOverride[];
  resourceRates: PricingScenarioResourceRateOverride[];
  products: PricingScenarioProductValues[];
  overheadPercent: string | null;
  targetProfitPercent: string | null;
  baseline: PricingBaseline;
  usageTerms: PricingUsageTermsDto[];
  revisions: PricingScenarioRevisionItem[];
};

type ScenarioPayload = Omit<UpdatePricingScenario, "expectedVersion">;

function detailToCardDoc(detail: PricingScenarioDetailData): ScenarioCardDoc {
  return {
    id: detail.scenario.id,
    name: detail.scenario.name,
    version: detail.scenario.version,
    productIds: detail.scenario.doc.productIds,
    materials: detail.scenario.doc.materials,
    resourceRates: detail.scenario.doc.resourceRates,
    products: detail.scenario.doc.products,
    overheadPercent: detail.scenario.doc.overheadPercent,
    targetProfitPercent: detail.scenario.doc.targetProfitPercent,
    baseline: detail.baseline,
    usageTerms: detail.usageTerms,
    revisions: detail.revisions,
  };
}

function makeDraftScenario(id: string): ScenarioCardDoc {
  return {
    id,
    name: "",
    version: 1,
    productIds: [],
    materials: [],
    resourceRates: [],
    products: [],
    overheadPercent: null,
    targetProfitPercent: null,
    baseline: { leafItems: [], resources: [], products: [] },
    usageTerms: [],
    revisions: [],
  };
}

function docFromDraft(draft: ScenarioCardDoc): PricingScenarioDoc {
  return {
    productIds: draft.productIds,
    materials: draft.materials,
    resourceRates: draft.resourceRates,
    products: draft.products,
    overheadPercent: draft.overheadPercent,
    targetProfitPercent: draft.targetProfitPercent,
  };
}

function trimDecimal(value: string | null | undefined, maxDp = 4): string | null {
  if (value == null || value.trim() === "") return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return value;
  return String(Number(num.toFixed(maxDp)));
}

function fmtMoney(value: string | null | undefined): string {
  if (value == null) return "—";
  return formatPrice(value) ?? value;
}

const MATERIAL_KEYS = ["price", "inboundFreight", "handling"] as const;
const PRODUCT_KEYS = ["currentPrice", "outboundFreight"] as const;

function serializeScenario(draft: ScenarioCardDoc): {
  payload: ScenarioPayload;
  pathAliases: Record<string, string>;
} {
  const pathAliases: Record<string, string> = {
    "doc.overheadPercent": "overheadPercent",
    "doc.targetProfitPercent": "targetProfitPercent",
    name: "name",
  };
  const materials = draft.materials.filter((row) =>
    MATERIAL_KEYS.some((key) => row[key] != null)
  );
  materials.forEach((row, index) => {
    for (const key of MATERIAL_KEYS) {
      pathAliases[`doc.materials.${index}.${key}`] = `materials.${row.itemId}.${key}`;
    }
  });
  const resourceRates = draft.resourceRates.filter((row) => row.rate != null);
  resourceRates.forEach((row, index) => {
    pathAliases[`doc.resourceRates.${index}.rate`] =
      `resourceRates.${row.resourceId}.rate`;
  });
  const products = draft.products.filter(
    (row) =>
      draft.productIds.includes(row.itemId) &&
      PRODUCT_KEYS.some((key) => row[key] != null)
  );
  products.forEach((row, index) => {
    for (const key of PRODUCT_KEYS) {
      pathAliases[`doc.products.${index}.${key}`] = `products.${row.itemId}.${key}`;
    }
  });

  return {
    payload: {
      name: draft.name,
      doc: {
        productIds: draft.productIds,
        materials,
        resourceRates,
        products,
        overheadPercent: draft.overheadPercent,
        targetProfitPercent: draft.targetProfitPercent,
      },
    },
    pathAliases,
  };
}

function upsertRow<T>(rows: T[], match: (row: T) => boolean, next: T | null): T[] {
  const index = rows.findIndex(match);
  if (next == null) {
    return index === -1 ? rows : rows.filter((_, i) => i !== index);
  }
  if (index === -1) {
    return [...rows, next];
  }
  return rows.map((row, i) => (i === index ? next : row));
}

export function PricingScenarioCard({
  initialScenarioId,
  initialDetail,
  productOptions,
}: {
  initialScenarioId: string | null;
  initialDetail: PricingScenarioDetailData | null;
  productOptions: InventoryItemComboboxOption[];
}) {
  const queryClient = useQueryClient();
  const [newScenarioId] = useState(() => crypto.randomUUID());
  const scenarioId = initialScenarioId ?? newScenarioId;

  const kernel = useCardKernel<ScenarioCardDoc, ScenarioPayload>({
    entityType: "pricing-scenario",
    id: scenarioId,
    initialServerDoc: initialDetail ? detailToCardDoc(initialDetail) : null,
    makeNewDoc: makeDraftScenario,
    collections: {
      materials: { idKey: "itemId" },
      resourceRates: { idKey: "resourceId" },
      products: { idKey: "itemId" },
    },
    schema: updatePricingScenarioSchema,
    serialize: serializeScenario,
    createGate: (draft) =>
      draft.productIds.length === 0 ? "Add a product to save" : null,
    create: async (payload, opts) =>
      detailToCardDoc(
        await createPricingScenarioDoc({ ...payload, id: scenarioId }, opts)
      ),
    update: async (id, payload, opts) =>
      detailToCardDoc(await updatePricingScenarioDoc(id, payload, opts)),
    readVersion: (doc) => doc.version,
    readConflictDoc: (current) =>
      detailToCardDoc(current as PricingScenarioDetailData),
    onServerDoc: (doc) => {
      queryClient.setQueryData(queryKeys.pricingScenarios.card(doc.id), doc);
      void queryClient.invalidateQueries({
        queryKey: queryKeys.pricingScenarios.root,
      });
    },
    onCreated: (doc) => {
      reflectPersistedCardUrlWithoutNavigation(`/sales/pricing-scenarios/${doc.id}`);
    },
  });

  const isDraft = !kernel.isPersisted;
  const draft = kernel.draft;

  const detailQuery = useQuery({
    queryKey: queryKeys.pricingScenarios.card(scenarioId),
    queryFn: async () => detailToCardDoc(await getPricingScenarioDetailData(scenarioId)),
    initialData: initialDetail ? detailToCardDoc(initialDetail) : undefined,
    enabled: !isDraft,
    refetchOnWindowFocus: false,
  });
  const refreshed = detailQuery.data;
  const adoptServerDoc = kernel.adoptServerDoc;
  useEffect(() => {
    if (refreshed) adoptServerDoc(refreshed);
  }, [adoptServerDoc, refreshed]);

  const actions = useCardEntityActions({
    entity: "pricing-scenario-action",
    getId: () => (kernel.isPersisted ? scenarioId : null),
    flush: kernel.flush,
    invalidateQueryKeys: [queryKeys.pricingScenarios.root],
    duplicate: {
      label: "Duplicate scenario",
      run: async (id) => {
        const detail = await duplicatePricingScenarioDoc(id);
        return { id: detail.scenario.id };
      },
      navigateTo: (id) => `/sales/pricing-scenarios/${id}`,
    },
    delete: {
      label: "Delete scenario",
      run: (id) => deletePricingScenario(id),
      navigateTo: "/sales/pricing-scenarios",
      confirm: {
        title: "Delete scenario?",
        description: (
          <>Committed revisions are kept for history, but the scenario leaves the list.</>
        ),
      },
    },
  });

  const calculation = useMemo(
    () =>
      calculatePricingScenario({
        baseline: draft.baseline,
        usageTerms: draft.usageTerms,
        doc: docFromDraft(draft),
      }),
    [draft]
  );
  const resultByProductId = useMemo(
    () => new Map(calculation.products.map((product) => [product.itemId, product])),
    [calculation]
  );

  const [selectedProductChoice, setSelectedProductChoice] = useState<string | null>(
    null
  );
  const selectedProductId =
    selectedProductChoice && draft.productIds.includes(selectedProductChoice)
      ? selectedProductChoice
      : (draft.productIds[0] ?? null);

  const selectedUsage = draft.usageTerms.find(
    (usage) => usage.productId === selectedProductId
  );
  const selectedResult = selectedProductId
    ? resultByProductId.get(selectedProductId)
    : undefined;
  const leafById = useMemo(
    () => new Map(draft.baseline.leafItems.map((leaf) => [leaf.itemId, leaf])),
    [draft.baseline.leafItems]
  );
  const resourceById = useMemo(
    () => new Map(draft.baseline.resources.map((row) => [row.resourceId, row])),
    [draft.baseline.resources]
  );
  const productMetaById = useMemo(
    () => new Map(draft.baseline.products.map((row) => [row.itemId, row])),
    [draft.baseline.products]
  );

  const addProduct = useCallback(
    (itemId: string | null) => {
      if (!itemId) return;
      kernel.update((current) =>
        current.productIds.includes(itemId)
          ? current
          : { ...current, productIds: [...current.productIds, itemId] }
      );
      setSelectedProductChoice(itemId);
    },
    [kernel]
  );

  const removeProduct = useCallback(
    (itemId: string) => {
      kernel.update((current) => ({
        ...current,
        productIds: current.productIds.filter((id) => id !== itemId),
        products: current.products.filter((row) => row.itemId !== itemId),
      }));
    },
    [kernel]
  );

  const setMaterialValue = useCallback(
    (itemId: string, key: (typeof MATERIAL_KEYS)[number], value: string | null) => {
      kernel.update((current) => {
        const existing = current.materials.find((row) => row.itemId === itemId) ?? {
          itemId,
          price: null,
          inboundFreight: null,
          handling: null,
        };
        const nextRow = { ...existing, [key]: value };
        const empty = MATERIAL_KEYS.every((k) => nextRow[k] == null);
        return {
          ...current,
          materials: upsertRow(
            current.materials,
            (row) => row.itemId === itemId,
            empty ? null : nextRow
          ),
        };
      });
    },
    [kernel]
  );

  const setResourceRate = useCallback(
    (resourceId: string, value: string | null) => {
      kernel.update((current) => ({
        ...current,
        resourceRates: upsertRow(
          current.resourceRates,
          (row) => row.resourceId === resourceId,
          value == null ? null : { resourceId, rate: value }
        ),
      }));
    },
    [kernel]
  );

  const setProductValue = useCallback(
    (itemId: string, key: (typeof PRODUCT_KEYS)[number], value: string | null) => {
      kernel.update((current) => {
        const existing = current.products.find((row) => row.itemId === itemId) ?? {
          itemId,
          currentPrice: null,
          outboundFreight: null,
        };
        const nextRow = { ...existing, [key]: value };
        const empty = PRODUCT_KEYS.every((k) => nextRow[k] == null);
        return {
          ...current,
          products: upsertRow(
            current.products,
            (row) => row.itemId === itemId,
            empty ? null : nextRow
          ),
        };
      });
    },
    [kernel]
  );

  const setGlobal = useCallback(
    (key: "overheadPercent" | "targetProfitPercent", value: string | null) => {
      kernel.update((current) => ({ ...current, [key]: value }));
    },
    [kernel]
  );

  // Commit revision
  const [commitOpen, setCommitOpen] = useState(false);
  const [commitNote, setCommitNote] = useState("");
  const [commitError, setCommitError] = useState<string | null>(null);
  const commitMutation = useMutation({
    mutationFn: async () => {
      const flushed = await kernel.flush();
      if (flushed.outcome !== "saved") {
        throw new Error(
          "error" in flushed
            ? flushed.error
            : "Resolve the highlighted fields before committing."
        );
      }
      return commitPricingScenarioRevisionDoc(scenarioId, commitNote.trim() || null);
    },
    onSuccess: () => {
      setCommitOpen(false);
      setCommitNote("");
      setCommitError(null);
      void queryClient.invalidateQueries({
        queryKey: queryKeys.pricingScenarios.card(scenarioId),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.pricingScenarios.root,
      });
    },
    onError: (error: Error) => setCommitError(error.message),
  });

  // View a committed revision
  const [viewRevisionId, setViewRevisionId] = useState<string | null>(null);
  const revisionQuery = useQuery({
    queryKey: queryKeys.pricingScenarios.revision(scenarioId, viewRevisionId ?? "none"),
    queryFn: () => getPricingScenarioRevisionData(scenarioId, viewRevisionId ?? ""),
    enabled: viewRevisionId != null,
  });
  const viewedRevision = viewRevisionId != null ? revisionQuery.data?.revision : undefined;
  const viewedMeta = draft.revisions.find((row) => row.id === viewRevisionId);

  const restoreFromSnapshot = (snapshot: PricingScenarioRevisionSnapshot) => {
    kernel.update((current) => {
      const materials = new Map<string, PricingScenarioMaterialOverride>();
      const resourceRates = new Map<string, PricingScenarioResourceRateOverride>();
      const products: PricingScenarioProductValues[] = [];
      for (const product of snapshot.products) {
        for (const term of product.materials) {
          if (
            term.priceSource !== "override" &&
            term.inboundFreight == null &&
            term.handling == null
          ) {
            continue;
          }
          materials.set(term.itemId, {
            itemId: term.itemId,
            price: term.priceSource === "override" ? term.unitPrice : null,
            inboundFreight: term.inboundFreight,
            handling: term.handling,
          });
        }
        for (const term of product.labor) {
          if (term.rateSource === "override" && term.resourceId) {
            resourceRates.set(term.resourceId, {
              resourceId: term.resourceId,
              rate: term.rate,
            });
          }
        }
        if (
          (product.currentPriceSource === "override" &&
            product.currentPrice != null) ||
          product.outboundFreight != null
        ) {
          products.push({
            itemId: product.itemId,
            currentPrice:
              product.currentPriceSource === "override"
                ? product.currentPrice
                : null,
            outboundFreight: product.outboundFreight,
          });
        }
      }
      return {
        ...current,
        productIds: snapshot.products.map((product) => product.itemId),
        materials: [...materials.values()],
        resourceRates: [...resourceRates.values()],
        products,
        overheadPercent: snapshot.globals.overheadPercent,
        targetProfitPercent: snapshot.globals.targetProfitPercent,
      };
    });
    setViewRevisionId(null);
  };

  const cardSaveState: CardSaveState = kernel.saveState;
  const nameError = fieldErrorAt(kernel.fieldErrors, "name");
  const availableOptions = productOptions.filter(
    (option) => !draft.productIds.includes(option.id)
  );

  const selectedMeta = selectedProductId
    ? productMetaById.get(selectedProductId)
    : undefined;
  const selectedOption = productOptions.find((row) => row.id === selectedProductId);
  const selectedLabel =
    selectedMeta?.name ?? selectedOption?.displayName ?? selectedOption?.name ?? "";
  const productUnit = (selectedMeta?.unitName ?? "unit").toLowerCase();
  const selectedValues = selectedProductId
    ? draft.products.find((row) => row.itemId === selectedProductId)
    : undefined;
  const materialRowById = new Map(
    (selectedResult?.materials ?? []).map((row) => [row.itemId, row])
  );
  const assumptionsInvalid =
    Number(draft.overheadPercent ?? 0) + Number(draft.targetProfitPercent ?? 0) >=
    100;
  const buckets = selectedResult?.buckets;
  const landedMaterialsTotal =
    buckets != null &&
    buckets.materials != null &&
    buckets.inboundFreight != null &&
    buckets.handling != null
      ? (
          Number(buckets.materials) +
          Number(buckets.inboundFreight) +
          Number(buckets.handling)
        ).toFixed(2)
      : null;
  const completeResult =
    selectedResult != null && !selectedResult.result.withheld
      ? selectedResult.result
      : null;
  const resolvedCurrentPrice = selectedResult?.currentPrice ?? null;
  const currentMarginNumber =
    completeResult?.currentMargin != null
      ? Number(completeResult.currentMargin)
      : null;
  const sellAtDelta =
    completeResult != null && resolvedCurrentPrice != null
      ? Number(completeResult.sellAt) - Number(resolvedCurrentPrice)
      : null;

  return (
    <CardPage>
      <CardPageHeader
        eyebrow="Pricing scenario"
        title={draft.name.trim() || "New scenario"}
        saveState={cardSaveState}
        saveMessage={kernel.saveMessage}
        fallbackHref="/sales/pricing-scenarios"
        showPrint={false}
        statusControl={
          isDraft ? null : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setCommitError(null);
                setCommitOpen(true);
              }}
            >
              <HugeiconsIcon icon={GitCommitIcon} strokeWidth={2} />
              Commit revision
            </Button>
          )
        }
        menuActions={
          isDraft
            ? []
            : [
                ...(actions.duplicateAction ? [actions.duplicateAction] : []),
                ...(actions.deleteAction ? [actions.deleteAction] : []),
              ]
        }
      />

      <CardPageBody>
        <CardSection title="Scenario">
          <CardFormRow columns="four">
            <CardField
              label="Name"
              htmlFor="scenario-name"
              required
              invalid={nameError != null}
              error={nameError}
            >
              <CommitInput
                id="scenario-name"
                label="Name"
                value={draft.name}
                autoFocus={isDraft}
                required
                className={underlineControlClass(nameError != null)}
                onCommit={(value) =>
                  kernel.update((current) => ({ ...current, name: value ?? "" }))
                }
              />
            </CardField>
          </CardFormRow>
        </CardSection>

        <CardSection
          title="Products"
          actions={
            <div className="w-64">
              <InventoryItemCombobox
                inputId="scenario-add-product"
                options={availableOptions}
                value={null}
                onValueChange={addProduct}
                placeholder="Add product"
                emptyMessage="No matching products"
              />
            </div>
          }
        >
          {draft.productIds.length === 0 ? (
            <EmptyState>
              Add a product to start costing. The scenario prices its full
              recipe from live data.
            </EmptyState>
          ) : (
            <ListFrame>
              {draft.productIds.map((productId) => {
                const meta = productMetaById.get(productId);
                const result = resultByProductId.get(productId);
                const option = productOptions.find((row) => row.id === productId);
                const label =
                  meta?.name ?? option?.displayName ?? option?.name ?? "New product";
                const sellAtLabel =
                  result == null
                    ? ""
                    : result.result.withheld
                      ? "—"
                      : `Sell at ${formatPrice(result.result.sellAt) ?? result.result.sellAt}`;
                return (
                  <SelectableListFrameItem
                    key={productId}
                    selected={productId === selectedProductId}
                    className="flex w-full items-center justify-between gap-(--space-4) px-(--space-6) py-(--space-4) text-left"
                    onClick={() => setSelectedProductChoice(productId)}
                  >
                    <span className="min-w-0 truncate">{label}</span>
                    <span className="flex shrink-0 items-center gap-(--space-4)">
                      <span className="font-mono text-[length:var(--text-sm)] tabular-nums">
                        {sellAtLabel}
                      </span>
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label={`Remove ${label}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          removeProduct(productId);
                        }}
                      >
                        <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
                      </Button>
                    </span>
                  </SelectableListFrameItem>
                );
              })}
            </ListFrame>
          )}
        </CardSection>

        {selectedProductId && selectedUsage ? (
          <CardSection
            title={selectedLabel || "Worksheet"}
            hint={selectedMeta?.unitName ? `priced per ${productUnit}` : undefined}
          >
            <div className="gap-(--space-12) lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(19rem,22rem)] lg:items-start">
              <div className="min-w-0 space-y-(--space-8)">
                <div>
                  <BlockLabel>Materials</BlockLabel>
                  {selectedUsage.materialTerms.length === 0 ? (
                    <EmptyState>
                      This product has no recipe components to cost.
                    </EmptyState>
                  ) : (
                    <div className="overflow-x-auto">
                      <div className="grid min-w-[44rem] grid-cols-[minmax(10rem,1.6fr)_minmax(6rem,1fr)_minmax(5.5rem,1fr)_minmax(5.5rem,1fr)_minmax(5.5rem,0.9fr)_minmax(6rem,0.9fr)] items-center gap-x-(--space-4) gap-y-(--space-2)">
                        <HeaderCell>Material</HeaderCell>
                        <HeaderCell align="end">Price</HeaderCell>
                        <HeaderCell align="end">Freight</HeaderCell>
                        <HeaderCell align="end">Handling</HeaderCell>
                        <HeaderCell align="end">Uses / {productUnit}</HeaderCell>
                        <HeaderCell align="end">Cost / {productUnit}</HeaderCell>
                        {selectedUsage.materialTerms.map((term) => {
                          const leaf = leafById.get(term.itemId);
                          const override = draft.materials.find(
                            (row) => row.itemId === term.itemId
                          );
                          const calcRow = materialRowById.get(term.itemId);
                          const materialUnit = (leaf?.unitName ?? "unit").toLowerCase();
                          const baselinePrice = trimDecimal(leaf?.baselinePrice);
                          return (
                            <div key={term.itemId} className="contents">
                              <div className="min-w-0 py-(--space-2)">
                                <div className="truncate text-[length:var(--text-sm)]">
                                  {leaf?.name ?? "Unknown item"}
                                </div>
                                <div className="truncate text-[length:var(--text-2xs)] text-[var(--color-ink-faint)]">
                                  {leaf?.sku ? `${leaf.sku} · ` : ""}per {materialUnit}
                                </div>
                              </div>
                              <div className="min-w-0">
                                <CommitInput
                                  label={`${leaf?.name ?? "Material"} price`}
                                  inputMode="decimal"
                                  value={override?.price ?? null}
                                  placeholder={baselinePrice ?? "0.00"}
                                  className={cn(
                                    underlineControlClass(false),
                                    "text-right font-mono tabular-nums"
                                  )}
                                  onCommit={(value) =>
                                    setMaterialValue(term.itemId, "price", value)
                                  }
                                />
                                {override?.price != null && baselinePrice != null ? (
                                  <InputCaption>live {baselinePrice}</InputCaption>
                                ) : baselinePrice == null ? (
                                  <InputCaption tone="warning">
                                    needs input
                                  </InputCaption>
                                ) : null}
                              </div>
                              <CommitInput
                                label={`${leaf?.name ?? "Material"} inbound freight`}
                                inputMode="decimal"
                                value={override?.inboundFreight ?? null}
                                placeholder="0"
                                className={cn(
                                  underlineControlClass(false),
                                  "text-right font-mono tabular-nums"
                                )}
                                onCommit={(value) =>
                                  setMaterialValue(term.itemId, "inboundFreight", value)
                                }
                              />
                              <CommitInput
                                label={`${leaf?.name ?? "Material"} handling`}
                                inputMode="decimal"
                                value={override?.handling ?? null}
                                placeholder="0"
                                className={cn(
                                  underlineControlClass(false),
                                  "text-right font-mono tabular-nums"
                                )}
                                onCommit={(value) =>
                                  setMaterialValue(term.itemId, "handling", value)
                                }
                              />
                              <div className="text-right font-mono text-[length:var(--text-sm)] tabular-nums">
                                {trimDecimal(term.quantityPerUnit) ?? term.quantityPerUnit}
                                <span className="ml-(--space-1) text-[length:var(--text-2xs)] text-[var(--color-ink-faint)]">
                                  {materialUnit}
                                </span>
                              </div>
                              <div className="text-right font-mono text-[length:var(--text-sm)] font-semibold tabular-nums">
                                {calcRow?.costPerUnit != null
                                  ? fmtMoney(calcRow.costPerUnit)
                                  : "—"}
                              </div>
                            </div>
                          );
                        })}
                        <div className="col-span-5 border-t border-[var(--color-line-soft)] pt-(--space-3) text-right text-[length:var(--text-sm)] font-medium">
                          Materials / {productUnit}
                        </div>
                        <div className="border-t border-[var(--color-line-soft)] pt-(--space-3) text-right font-mono text-[length:var(--text-sm)] font-semibold tabular-nums">
                          {landedMaterialsTotal != null
                            ? fmtMoney(landedMaterialsTotal)
                            : "—"}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {selectedUsage.laborTerms.length > 0 ? (
                  <div>
                    <BlockLabel>Labor</BlockLabel>
                    <div className="overflow-x-auto">
                      <div className="grid min-w-[32rem] grid-cols-[minmax(10rem,1.8fr)_minmax(6rem,1fr)_minmax(5.5rem,1fr)_minmax(6rem,1fr)] items-center gap-x-(--space-4) gap-y-(--space-2)">
                        <HeaderCell>Operation</HeaderCell>
                        <HeaderCell align="end">Rate / hour</HeaderCell>
                        <HeaderCell align="end">Hours / {productUnit}</HeaderCell>
                        <HeaderCell align="end">Cost / {productUnit}</HeaderCell>
                        {selectedUsage.laborTerms.map((term) => {
                          const resource = term.resourceId
                            ? resourceById.get(term.resourceId)
                            : null;
                          const override = term.resourceId
                            ? draft.resourceRates.find(
                                (row) => row.resourceId === term.resourceId
                              )
                            : undefined;
                          const baselineRate = trimDecimal(
                            resource?.baselineRate ?? term.fallbackRatePerHour
                          );
                          const effectiveRate =
                            override?.rate ??
                            resource?.baselineRate ??
                            term.fallbackRatePerHour;
                          const hoursNumber = Number(term.hoursPerUnit);
                          const rateNumber =
                            effectiveRate == null ? NaN : Number(effectiveRate);
                          const laborCost =
                            Number.isFinite(hoursNumber) && Number.isFinite(rateNumber)
                              ? (hoursNumber * rateNumber).toFixed(2)
                              : null;
                          return (
                            <div
                              key={term.resourceId ?? "unassigned"}
                              className="contents"
                            >
                              <div className="min-w-0 py-(--space-2)">
                                <div className="truncate text-[length:var(--text-sm)]">
                                  {resource?.name ?? "Unassigned"}
                                </div>
                                <div className="truncate text-[length:var(--text-2xs)] text-[var(--color-ink-faint)]">
                                  from routing
                                </div>
                              </div>
                              {term.resourceId ? (
                                <div className="min-w-0">
                                  <CommitInput
                                    label={`${resource?.name ?? "Resource"} rate`}
                                    inputMode="decimal"
                                    value={override?.rate ?? null}
                                    placeholder={baselineRate ?? "0.00"}
                                    className={cn(
                                      underlineControlClass(false),
                                      "text-right font-mono tabular-nums"
                                    )}
                                    onCommit={(value) =>
                                      setResourceRate(term.resourceId!, value)
                                    }
                                  />
                                  {override?.rate != null && baselineRate != null ? (
                                    <InputCaption>live {baselineRate}</InputCaption>
                                  ) : baselineRate == null ? (
                                    <InputCaption tone="warning">
                                      needs input
                                    </InputCaption>
                                  ) : null}
                                </div>
                              ) : (
                                <div className="text-right font-mono text-[length:var(--text-sm)] tabular-nums">
                                  {baselineRate ?? "—"}
                                </div>
                              )}
                              <div className="text-right font-mono text-[length:var(--text-sm)] tabular-nums">
                                {trimDecimal(term.hoursPerUnit) ?? term.hoursPerUnit}
                              </div>
                              <div className="text-right font-mono text-[length:var(--text-sm)] font-semibold tabular-nums">
                                {laborCost != null ? fmtMoney(laborCost) : "—"}
                              </div>
                            </div>
                          );
                        })}
                        <div className="col-span-3 border-t border-[var(--color-line-soft)] pt-(--space-3) text-right text-[length:var(--text-sm)] font-medium">
                          Labor / {productUnit}
                        </div>
                        <div className="border-t border-[var(--color-line-soft)] pt-(--space-3) text-right font-mono text-[length:var(--text-sm)] font-semibold tabular-nums">
                          {buckets?.labor != null ? fmtMoney(buckets.labor) : "—"}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}

                <div>
                  <BlockLabel>Pricing</BlockLabel>
                  <CardFormRow columns="four">
                    <CardField label="Current price" htmlFor="scenario-current-price">
                      <CommitInput
                        id="scenario-current-price"
                        label="Current price"
                        inputMode="decimal"
                        value={selectedValues?.currentPrice ?? null}
                        placeholder={
                          trimDecimal(selectedMeta?.baselineCurrentPrice, 2) ??
                          "Not set"
                        }
                        className={cn(
                          underlineControlClass(false),
                          "font-mono tabular-nums"
                        )}
                        onCommit={(value) =>
                          setProductValue(selectedProductId, "currentPrice", value)
                        }
                      />
                      {selectedValues?.currentPrice != null &&
                      selectedMeta?.baselineCurrentPrice != null ? (
                        <InputCaption align="start">
                          live {trimDecimal(selectedMeta.baselineCurrentPrice, 2)}
                        </InputCaption>
                      ) : null}
                    </CardField>
                    <CardField label="Outbound freight" htmlFor="scenario-outbound">
                      <CommitInput
                        id="scenario-outbound"
                        label="Outbound freight"
                        inputMode="decimal"
                        value={selectedValues?.outboundFreight ?? null}
                        placeholder="0"
                        className={cn(
                          underlineControlClass(false),
                          "font-mono tabular-nums"
                        )}
                        onCommit={(value) =>
                          setProductValue(selectedProductId, "outboundFreight", value)
                        }
                      />
                      <InputCaption align="start">per {productUnit}</InputCaption>
                    </CardField>
                  </CardFormRow>
                </div>
              </div>

              <aside className="mt-(--space-8) flex min-w-0 flex-col gap-(--space-4) lg:sticky lg:top-0 lg:mt-0">
                <RailPanel>
                  <BlockLabel>Assumptions</BlockLabel>
                  <div className="grid grid-cols-2 gap-(--space-4)">
                    <CardField
                      label="Overhead %"
                      htmlFor="scenario-overhead"
                      invalid={assumptionsInvalid}
                    >
                      <CommitInput
                        id="scenario-overhead"
                        label="Overhead %"
                        inputMode="decimal"
                        value={draft.overheadPercent}
                        placeholder="0"
                        className={cn(
                          underlineControlClass(assumptionsInvalid),
                          "font-mono tabular-nums"
                        )}
                        onCommit={(value) => setGlobal("overheadPercent", value)}
                      />
                    </CardField>
                    <CardField
                      label="Target profit %"
                      htmlFor="scenario-profit"
                      invalid={assumptionsInvalid}
                    >
                      <CommitInput
                        id="scenario-profit"
                        label="Target profit %"
                        inputMode="decimal"
                        value={draft.targetProfitPercent}
                        placeholder="0"
                        className={cn(
                          underlineControlClass(assumptionsInvalid),
                          "font-mono tabular-nums"
                        )}
                        onCommit={(value) => setGlobal("targetProfitPercent", value)}
                      />
                    </CardField>
                  </div>
                  <p
                    className={cn(
                      "mt-(--space-3) text-[length:var(--text-2xs)]",
                      assumptionsInvalid
                        ? "text-[var(--status-danger-ink)]"
                        : "text-[var(--color-ink-faint)]"
                    )}
                  >
                    {assumptionsInvalid
                      ? "Together they must stay under 100% of the selling price."
                      : "Shares of the selling price, applied to every product."}
                  </p>
                </RailPanel>

                {selectedResult?.result.withheld ? (
                  <RailPanel className="bg-[var(--color-warning-soft)]">
                    <div className="flex items-center gap-(--space-3) text-[var(--color-accent-ink)]">
                      <HugeiconsIcon
                        icon={Alert02Icon}
                        className="size-(--space-7)"
                        strokeWidth={2}
                      />
                      <span className="text-[length:var(--text-xs)] font-medium tracking-wide uppercase">
                        Needs attention
                      </span>
                    </div>
                    <ul className="mt-(--space-3) list-disc space-y-(--space-1) pl-(--space-6) text-[length:var(--text-sm)] text-[var(--color-ink-muted)]">
                      {selectedResult.result.issues.map((issue) => (
                        <li key={issue}>{issue}</li>
                      ))}
                    </ul>
                  </RailPanel>
                ) : null}

                {completeResult && buckets != null ? (
                  <>
                    <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line-soft)]">
                      <div className="p-(--space-5)">
                        <BlockLabel className="mb-(--space-1)">
                          Cost to recover / {productUnit}
                        </BlockLabel>
                        <div className="font-mono text-[length:var(--text-lg)] font-semibold tabular-nums">
                          {fmtMoney(buckets.costToRecover)}
                        </div>
                      </div>
                      <div className="bg-[var(--color-accent-soft)] p-(--space-5)">
                        <div className="flex items-baseline justify-between gap-(--space-3)">
                          <BlockLabel className="mb-(--space-1)">Sell at</BlockLabel>
                          <span className="text-[length:var(--text-2xs)] text-[var(--color-ink-muted)]">
                            {trimDecimal(draft.overheadPercent, 2) ?? "0"}% overhead ·{" "}
                            {trimDecimal(draft.targetProfitPercent, 2) ?? "0"}% profit
                          </span>
                        </div>
                        <div className="font-mono text-[length:var(--text-xl)] font-semibold tabular-nums">
                          {fmtMoney(completeResult.sellAt)}
                        </div>
                        {sellAtDelta != null && resolvedCurrentPrice != null ? (
                          <p className="mt-(--space-2) text-[length:var(--text-2xs)] text-[var(--color-ink-muted)]">
                            {sellAtDelta > 0.005
                              ? `Raise ${fmtMoney(sellAtDelta.toFixed(2))} from current ${fmtMoney(resolvedCurrentPrice)}`
                              : sellAtDelta < -0.005
                                ? `Current ${fmtMoney(resolvedCurrentPrice)} already clears this by ${fmtMoney(Math.abs(sellAtDelta).toFixed(2))}`
                                : `Matches the current price`}
                          </p>
                        ) : null}
                      </div>
                    </div>

                    <RailPanel>
                      <BlockLabel>Breakdown / {productUnit}</BlockLabel>
                      <BreakdownRow
                        label="Materials (landed)"
                        value={fmtMoney(landedMaterialsTotal)}
                      />
                      <BreakdownRow label="Labor" value={fmtMoney(buckets.labor)} />
                      <BreakdownRow
                        label="Direct cost"
                        value={fmtMoney(buckets.directCost)}
                        strong
                        rule
                      />
                      <BreakdownRow
                        label="Outbound freight"
                        value={fmtMoney(selectedResult?.outboundFreight ?? "0")}
                      />
                      <BreakdownRow
                        label="Cost to recover"
                        value={fmtMoney(buckets.costToRecover)}
                        strong
                        rule
                      />
                      <BreakdownRow
                        label={`Overhead at ${fmtMoney(completeResult.sellAt)}`}
                        value={fmtMoney(completeResult.overheadDollars)}
                      />
                      <BreakdownRow
                        label={`Profit at ${fmtMoney(completeResult.sellAt)}`}
                        value={fmtMoney(completeResult.profitDollars)}
                      />
                    </RailPanel>

                    {currentMarginNumber != null ? (
                      <RailPanel>
                        <BlockLabel className="mb-(--space-1)">
                          Margin at current price
                        </BlockLabel>
                        <div
                          className={cn(
                            "font-mono text-[length:var(--text-lg)] font-semibold tabular-nums",
                            currentMarginNumber < 0
                              ? "text-[var(--status-danger-ink)]"
                              : currentMarginNumber <
                                  Number(draft.targetProfitPercent ?? 0)
                                ? "text-[var(--color-accent-ink)]"
                                : "text-[var(--status-success-ink)]"
                          )}
                        >
                          {completeResult.currentMargin}%
                        </div>
                        <p className="mt-(--space-1) text-[length:var(--text-2xs)] text-[var(--color-ink-faint)]">
                          At current {fmtMoney(resolvedCurrentPrice)} · target{" "}
                          {trimDecimal(draft.targetProfitPercent, 2) ?? "0"}% profit
                        </p>
                      </RailPanel>
                    ) : null}
                  </>
                ) : null}
              </aside>
            </div>
          </CardSection>
        ) : null}

        {!isDraft ? (
          <CardSection title="Revisions">
            {draft.revisions.length === 0 ? (
              <EmptyState>
                No revisions yet. Commit one to freeze today&apos;s costs and
                recommendations as a numbered record.
              </EmptyState>
            ) : (
              <ListFrame>
                {draft.revisions.map((revision) => (
                  <SelectableListFrameItem
                    key={revision.id}
                    className="flex w-full items-center justify-between gap-(--space-4) px-(--space-6) py-(--space-4) text-left"
                    onClick={() => setViewRevisionId(revision.id)}
                  >
                    <span className="flex min-w-0 items-center gap-(--space-4)">
                      <span className="font-mono text-[length:var(--text-sm)] tabular-nums">
                        Rev {revision.revisionNumber}
                      </span>
                      {revision.note ? (
                        <span className="min-w-0 truncate text-[length:var(--text-sm)] text-[var(--color-ink-muted)]">
                          {revision.note}
                        </span>
                      ) : null}
                    </span>
                    <span className="shrink-0 text-[length:var(--text-sm)] text-[var(--color-ink-muted)]">
                      {formatDate(toDateOnlyString(revision.createdAt))}
                    </span>
                  </SelectableListFrameItem>
                ))}
              </ListFrame>
            )}
          </CardSection>
        ) : null}
      </CardPageBody>

      {actions.dialogs}

      <Dialog open={commitOpen} onOpenChange={setCommitOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Commit revision</DialogTitle>
            <DialogDescription>
              Freezes today&apos;s live costs, your overrides, and the results
              as revision {draft.revisions.length > 0 ? draft.revisions[0].revisionNumber + 1 : 1}.
              Committed revisions never change.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={commitNote}
            onChange={(event) => setCommitNote(event.target.value)}
            placeholder="Note (optional)"
            rows={2}
          />
          {commitError ? (
            <p className="text-[length:var(--text-sm)] text-[var(--status-danger-ink)]">
              {commitError}
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCommitOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => commitMutation.mutate()}
              disabled={commitMutation.isPending}
            >
              {commitMutation.isPending ? "Committing…" : "Commit revision"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={viewRevisionId != null}
        onOpenChange={(open) => {
          if (!open) setViewRevisionId(null);
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              Revision {viewedMeta?.revisionNumber ?? viewedRevision?.revisionNumber ?? ""}
            </DialogTitle>
            <DialogDescription>
              {viewedMeta
                ? `Committed ${formatDate(toDateOnlyString(viewedMeta.createdAt))}${viewedMeta.note ? ` — ${viewedMeta.note}` : ""}`
                : null}
            </DialogDescription>
          </DialogHeader>
          {viewedRevision ? (
            <div className="max-h-96 overflow-y-auto">
              <div className="mb-(--space-4) text-[length:var(--text-sm)] text-[var(--color-ink-muted)]">
                Overhead {viewedRevision.snapshot.globals.overheadPercent ?? "0"}% ·
                Target profit {viewedRevision.snapshot.globals.targetProfitPercent ?? "0"}%
              </div>
              <div className="grid grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))] gap-x-(--space-4) gap-y-(--space-2)">
                <HeaderCell>Product</HeaderCell>
                <HeaderCell>Cost to recover</HeaderCell>
                <HeaderCell>Sell at</HeaderCell>
                <HeaderCell>Margin</HeaderCell>
                {viewedRevision.snapshot.products.map((product) => (
                  <div key={product.itemId} className="contents">
                    <div className="min-w-0 truncate text-[length:var(--text-sm)]">
                      {product.name}
                    </div>
                    <div className="font-mono text-[length:var(--text-sm)] tabular-nums">
                      {product.buckets.costToRecover != null
                        ? (formatPrice(product.buckets.costToRecover) ?? "—")
                        : "—"}
                    </div>
                    <div className="font-mono text-[length:var(--text-sm)] tabular-nums">
                      {product.result.withheld
                        ? "Withheld"
                        : (formatPrice(product.result.sellAt) ?? "—")}
                    </div>
                    <div className="font-mono text-[length:var(--text-sm)] tabular-nums">
                      {!product.result.withheld && product.result.currentMargin != null
                        ? `${product.result.currentMargin}%`
                        : "—"}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="py-(--space-8) text-center text-[length:var(--text-sm)] text-[var(--color-ink-muted)]">
              Loading…
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewRevisionId(null)}>
              Close
            </Button>
            {viewedRevision ? (
              <Button onClick={() => restoreFromSnapshot(viewedRevision.snapshot)}>
                Restore to draft
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </CardPage>
  );
}

function HeaderCell({
  children,
  align = "start",
}: {
  children: React.ReactNode;
  align?: "start" | "end";
}) {
  return (
    <div
      className={cn(
        "text-[length:var(--text-xs)] font-medium tracking-wide text-[var(--color-ink-faint)] uppercase",
        align === "end" && "text-right"
      )}
    >
      {children}
    </div>
  );
}

function BlockLabel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mb-(--space-3) text-[length:var(--text-xs)] font-medium tracking-wide text-[var(--color-ink-faint)] uppercase",
        className
      )}
    >
      {children}
    </div>
  );
}

function InputCaption({
  children,
  align = "end",
  tone = "muted",
}: {
  children: React.ReactNode;
  align?: "start" | "end";
  tone?: "muted" | "warning";
}) {
  return (
    <div
      className={cn(
        "mt-(--space-1) truncate text-[length:var(--text-2xs)]",
        align === "end" && "text-right",
        tone === "warning"
          ? "text-[var(--color-accent-ink)]"
          : "text-[var(--color-ink-faint)]"
      )}
    >
      {children}
    </div>
  );
}

function RailPanel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius-md)] border border-[var(--color-line-soft)] p-(--space-5)",
        className
      )}
    >
      {children}
    </div>
  );
}

function BreakdownRow({
  label,
  value,
  strong = false,
  rule = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
  rule?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-(--space-4) py-(--space-1)",
        rule && "mt-(--space-1) border-t border-[var(--color-line-soft)] pt-(--space-2)"
      )}
    >
      <span
        className={cn(
          "min-w-0 truncate text-[length:var(--text-sm)]",
          strong ? "font-medium" : "text-[var(--color-ink-muted)]"
        )}
      >
        {label}
      </span>
      <span
        className={cn(
          "font-mono text-[length:var(--text-sm)] tabular-nums",
          strong && "font-semibold"
        )}
      >
        {value}
      </span>
    </div>
  );
}
