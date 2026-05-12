"use client";

import { useEffect, useMemo, useState } from "react";
import { useSmartBack } from "@/lib/hooks/use-smart-back";
import { apiJson } from "@/lib/client/api";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import { CircleLock01Icon, CircleUnlock01Icon } from "@hugeicons/core-free-icons";
import { formatPrice, getFirstFormErrorMessage, parsePositive } from "@/lib/format";
import { resolveStockUnitCostFromDefaultPurchasePrice } from "@/lib/inventory/cost";
import {
  insertItemSchema,
  insertMasterItemSchema,
  updateItemSchema,
  type InsertItemFormValues,
  type InsertMasterItemFormValues,
  type UpdateItemFormValues,
} from "@/lib/schemas/items";
import { ITEM_TYPE_SEGMENTS } from "@/app/(dashboard)/inventory/types";
import type { getItem } from "@/app/(dashboard)/inventory/queries";
import { getUomOptions } from "@/lib/units-of-measure";
import { derivePurchaseToStockFactor } from "@/lib/units-of-measure";
import { Button } from "@/components/ui/button";
import {
  CreatePageGrid,
  CreatePageHeader,
  CreatePageShell,
  CreateSection,
  CreateSidebarCard,
  SummaryRows,
} from "@/components/create-page";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { TooltipHeader } from "@/components/tooltip-header";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Badge } from "@/components/ui/badge";
import { BomEditor } from "@/app/(dashboard)/inventory/bom-editor";
import { BomLockConfirmDialog } from "./dialogs/bom-lock-confirm-dialog";
import { CreateUnitDialog } from "./dialogs/create-unit-dialog";
import { CurrentStockCostDialog } from "./dialogs/current-stock-cost-dialog";
import { AxesInput } from "./fields/axes-input";
import {
  CURRENT_STOCK_UNIT_COST_TOOLTIP,
  ITEM_CATEGORY_TOOLTIP,
  ITEM_SKU_TOOLTIP,
  ON_HAND_STOCK_TOOLTIP,
  PURCHASE_CONVERSION_TOOLTIP,
  PURCHASE_PRICE_TOOLTIP,
  PURCHASE_UNIT_TOOLTIP,
  SAFETY_STOCK_TOOLTIP,
  SELLING_PRICE_TOOLTIP,
  STOCKING_UNIT_TOOLTIP,
  BATCH_YIELD_TOOLTIP,
} from "@/lib/tooltip-copy";

const CREATE_NEW_UNIT = "__create_new__";
const POSITIVE_NUMBER_RE = /^\d+\.?\d*$/;
const uomGroups = getUomOptions();

type AvailableComponent = {
  id: string;
  name: string;
  displayName: string;
  itemType: string;
  unit: string;
};

interface ItemFormProps {
  itemType: "material" | "product";
  units: { id: string; name: string; size: string; uom: string }[];
  categories: string[];
  availableComponents?: AvailableComponent[];
  canManageBomLock?: boolean;
  initialData?: NonNullable<Awaited<ReturnType<typeof getItem>>> & {
    bom?: {
      componentId: string;
      quantity: string | null;
      minimumLotAgeDays?: number | null;
      alternates?: Array<{ itemId: string }>;
    }[];
  };
}

type ItemFormValues = InsertItemFormValues | UpdateItemFormValues | InsertMasterItemFormValues;
type ItemMutationResult = { id: string };
type CurrentStockUnitCostResult = { id: string; currentStockUnitCost: string | null };
type UnitDefinitionResult = { id: string; name: string; size: string; uom: string };
type XeroAccountOption = {
  code: string;
  name: string;
  type: string | null;
};

export function ItemForm({
  itemType,
  units,
  categories,
  availableComponents,
  canManageBomLock = false,
  initialData,
}: ItemFormProps) {
  const queryClient = useQueryClient();
  const segment = ITEM_TYPE_SEGMENTS[itemType];
  const isEditing = Boolean(initialData);
  const isVariant = itemType === "product" && initialData?.parentId != null;
  const typeLabel = itemType === "product" ? "Product" : "Material";
  const fallbackPath = `/inventory/${segment}${initialData ? `/${initialData.id}` : ""}`;
  const [isMaster, setIsMaster] = useState(initialData?.isMaster ?? false);
  const variantFamilyName = isVariant ? (initialData?.parentName ?? initialData?.name ?? "") : "";
  const variantTitle = isVariant ? (initialData?.displayName ?? variantFamilyName) : "";
  const showMasterToggle = itemType === "product" && !isEditing && !initialData?.isMaster;
  const [categoryInput, setCategoryInput] = useState("");
  const [localUnits, setLocalUnits] = useState(units);
  const [isUnitDialogOpen, setIsUnitDialogOpen] = useState(false);
  const [bomLockConfirmOpen, setBomLockConfirmOpen] = useState(false);
  const [pendingBomLocked, setPendingBomLocked] = useState<boolean | null>(null);
  const [currentStockUnitCostDialogOpen, setCurrentStockUnitCostDialogOpen] =
    useState(false);
  const [currentStockUnitCostDraft, setCurrentStockUnitCostDraft] = useState("");
  const [currentStockUnitCostError, setCurrentStockUnitCostError] = useState<string | null>(
    null
  );
  const [unitName, setUnitName] = useState("");
  const [unitSize, setUnitSize] = useState("");
  const [unitUom, setUnitUom] = useState("");
  const unitSizeInvalid = unitSize.trim() !== "" && !POSITIVE_NUMBER_RE.test(unitSize.trim());
  const resetUnitForm = () => {
    setUnitName("");
    setUnitSize("");
    setUnitUom("");
  };

  const categoriesSet = useMemo(
    () => new Set(categories.map((c) => c.toLowerCase())),
    [categories]
  );

  const categoryItems = useMemo(() => {
    const trimmed = categoryInput.trim();
    if (trimmed && !categoriesSet.has(trimmed.toLowerCase())) {
      return [...categories, trimmed];
    }
    return categories;
  }, [categoryInput, categories, categoriesSet]);

  const activeSchema = isMaster
    ? insertMasterItemSchema
    : initialData
      ? updateItemSchema
      : insertItemSchema;

  const form = useForm<ItemFormValues>({
    resolver: zodResolver(activeSchema),
    mode: "onBlur",
    defaultValues: initialData
      ? {
          name: initialData.name,
          purchaseUnitDefinitionId: initialData.purchaseUnitDefinitionId,
          purchaseToStockFactor: initialData.purchaseToStockFactor,
          sku: initialData.sku,
          category: initialData.category,
          description: initialData.description,
          defaultPurchasePrice: initialData.defaultPurchasePrice,
          xeroPurchaseAccountCode: initialData.xeroPurchaseAccountCode,
          currentStockUnitCost: initialData.currentStockUnitCost,
          defaultSellingPrice: initialData.defaultSellingPrice,
          sellable: initialData.sellable ?? true,
          manufacturingMode: initialData.manufacturingMode as "discrete" | "batch" ?? "discrete",
          expectedBatchYield: initialData.expectedBatchYield,
          bomLocked: initialData.bomLocked ?? false,
          stock: initialData.stock,
          safetyStock: initialData.safetyStock,
          bom: initialData.bom ?? [],
          revisionNote: null,
        }
      : isMaster
        ? {
            name: "",
            description: null,
            category: null,
            variantAxes: [],
          }
        : {
            name: "",
            itemType: itemType as "material" | "product",
            unitDefinitionId: "",
            purchaseUnitDefinitionId: null,
            purchaseToStockFactor: null,
            sku: null,
            category: null,
            description: null,
            defaultPurchasePrice: null,
            xeroPurchaseAccountCode: null,
            currentStockUnitCost: null,
            defaultSellingPrice: null,
            sellable: true,
            manufacturingMode: "discrete" as const,
            expectedBatchYield: null,
            bomLocked: false,
            stock: "0",
            safetyStock: "0",
            bom: [],
            revisionNote: null,
          },
  });

  const [formError, setFormError] = useState<string | null>(null);
  const [unitError, setUnitError] = useState<string | null>(null);
  const xeroAccountsQuery = useQuery({
    queryKey: ["xero-accounts"],
    queryFn: async () => {
      const response = await fetch("/api/xero/accounts");
      if (!response.ok) return { accounts: [] as XeroAccountOption[] };
      return response.json() as Promise<{ accounts: XeroAccountOption[] }>;
    },
  });
  const xeroAccounts = xeroAccountsQuery.data?.accounts ?? [];
  const bomLocked = useWatch({
    control: form.control,
    name: "bomLocked",
  });
  const watchedManufacturingMode = useWatch({
    control: form.control,
    name: "manufacturingMode",
  });
  const selectedStockingUnitId = useWatch({
    control: form.control,
    name: "unitDefinitionId",
  });
  const selectedPurchaseUnitId = useWatch({
    control: form.control,
    name: "purchaseUnitDefinitionId",
  });
  const watchedDefaultPurchasePrice = useWatch({
    control: form.control,
    name: "defaultPurchasePrice",
  });
  const watchedPurchaseToStockFactor = useWatch({
    control: form.control,
    name: "purchaseToStockFactor",
  });
  const watchedCurrentStockUnitCost = useWatch({
    control: form.control,
    name: "currentStockUnitCost",
  });
  const watchedDefaultSellingPrice = useWatch({
    control: form.control,
    name: "defaultSellingPrice",
  });
  const watchedStock = useWatch({
    control: form.control,
    name: "stock",
  });
  const watchedSafetyStock = useWatch({
    control: form.control,
    name: "safetyStock",
  });

  const stockingUnit = useMemo(() => {
    const unitId = isEditing ? initialData?.unitDefinitionId : selectedStockingUnitId;
    return localUnits.find((unit) => unit.id === unitId) ?? null;
  }, [initialData?.unitDefinitionId, isEditing, localUnits, selectedStockingUnitId]);

  const purchaseUnit = useMemo(
    () => localUnits.find((unit) => unit.id === selectedPurchaseUnitId) ?? null,
    [localUnits, selectedPurchaseUnitId]
  );

  const derivedPurchaseFactor = useMemo(() => {
    if (!stockingUnit || !purchaseUnit) {
      return null;
    }

    return derivePurchaseToStockFactor(purchaseUnit, stockingUnit);
  }, [purchaseUnit, stockingUnit]);

  useEffect(() => {
    if (isMaster) return;

    if (!selectedPurchaseUnitId) {
      form.setValue("purchaseToStockFactor" as never, null as never, {
        shouldDirty: true,
        shouldValidate: true,
      });
      return;
    }

    if (derivedPurchaseFactor == null) {
      form.setValue("purchaseToStockFactor" as never, null as never, {
        shouldDirty: true,
        shouldValidate: true,
      });
      return;
    }

    form.setValue("purchaseToStockFactor" as never, derivedPurchaseFactor.toFixed(4).replace(/\.?0+$/, "") as never, {
      shouldDirty: true,
      shouldValidate: true,
    });
  }, [derivedPurchaseFactor, form, isMaster, selectedPurchaseUnitId]);

  const mutation = useMutation({
    mutationFn: async (data: ItemFormValues) => {
      const url = initialData ? `/api/items/${initialData.id}` : "/api/items";
      const method = initialData ? "PUT" : "POST";
      const nextData = isVariant ? { ...data, name: variantFamilyName } : data;
      const basePayload = isMaster ? { ...nextData, isMaster: true } : nextData;
      const payload =
        initialData && itemType === "material"
          ? (() => {
              const nextPayload = {
                ...basePayload,
              } as typeof basePayload & { currentStockUnitCost?: string | null };
              delete nextPayload.currentStockUnitCost;
              return nextPayload;
            })()
          : basePayload;
      const fallback = initialData
        ? `Failed to update ${typeLabel.toLowerCase()}.`
        : `Failed to create ${typeLabel.toLowerCase()}.`;
      return apiJson<ItemMutationResult>(url, {
        method,
        idempotencyKey: "item-form-save",
        body: payload,
        fallbackError: fallback,
      });
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["items"] });
      const nextPath = isEditing ? fallbackPath : `/inventory/${segment}/${result.id}`;
      window.setTimeout(() => {
        window.location.assign(nextPath);
      }, 250);
    },
    onError: (error) => {
      setFormError(error.message);
    },
    onMutate: () => {
      setFormError(null);
    },
  });
  const handleInvalidSubmit = (errors: typeof form.formState.errors) => {
    setFormError(
      getFirstFormErrorMessage(errors) ?? "Fix the highlighted fields."
    );
  };

  const currentStockUnitCostMutation = useMutation({
    mutationFn: async () => {
      if (!initialData) {
        throw new Error("Current stock unit cost can only be overridden after the item exists.");
      }

      return apiJson<CurrentStockUnitCostResult>(
        `/api/items/${initialData.id}/current-stock-unit-cost`,
        {
          method: "PUT",
          idempotencyKey: "item-current-stock-unit-cost",
          body: {
            currentStockUnitCost: currentStockUnitCostDraft,
          },
          fallbackError: "Failed to update current stock unit cost.",
          mapError: (_status, body) => {
            const payload = body as
              | {
                  error?: unknown;
                  errors?: { currentStockUnitCost?: string[] };
                }
              | null;
            const fieldMessage = payload?.errors?.currentStockUnitCost?.[0];
            const message =
              fieldMessage ??
              (typeof payload?.error === "string"
                ? payload.error
                : "Failed to update current stock unit cost.");
            return new Error(message);
          },
        }
      );
    },
    onSuccess: async (result) => {
      setCurrentStockUnitCostDraft(result.currentStockUnitCost ?? "");
      setCurrentStockUnitCostDialogOpen(false);
      setCurrentStockUnitCostError(null);
      form.setValue(
        "currentStockUnitCost" as never,
        (result.currentStockUnitCost ?? null) as never,
        {
          shouldDirty: false,
          shouldTouch: false,
          shouldValidate: false,
        }
      );
      await queryClient.invalidateQueries({ queryKey: ["items"] });
    },
    onError: (error) => {
      setCurrentStockUnitCostError(error.message);
    },
    onMutate: () => {
      setCurrentStockUnitCostError(null);
    },
  });

  const unitMutation = useMutation({
    mutationFn: async () => {
      return apiJson<UnitDefinitionResult>("/api/units", {
        method: "POST",
        body: { name: unitName, size: unitSize, uom: unitUom },
        fallbackError: "Failed to create unit.",
      });
    },
    onSuccess: (newUnit) => {
      setLocalUnits((prev) => [...prev, newUnit]);
      if (!isMaster) {
        form.setValue("unitDefinitionId" as never, newUnit.id as never);
      }
      setIsUnitDialogOpen(false);
      resetUnitForm();
      setUnitError(null);
    },
    onError: (error) => {
      setUnitError(error.message);
    },
    onMutate: () => {
      setUnitError(null);
    },
  });

  const submitLabel = isEditing
    ? (mutation.isPending ? "Saving..." : "Save Changes")
    : (mutation.isPending ? "Creating..." : isMaster ? "Create Variant Master" : `Create ${typeLabel}`);
  const isBomDirty = itemType === "product" && !isMaster && Boolean((form.formState.dirtyFields as Record<string, unknown>).bom);
  const lockTarget = pendingBomLocked ?? bomLocked;
  const lockDialogTitle = lockTarget ? "Lock this BOM?" : "Unlock this BOM?";
  const lockDialogDescription = lockTarget
    ? "Only inventory admins will be able to view and edit this BOM once it is locked."
    : "Members with inventory view or operate access will be able to view and edit this BOM once it is unlocked.";

  const handleCancel = useSmartBack(fallbackPath);
  const currentStockUnitCost = parsePositive(
    (watchedCurrentStockUnitCost as string | null | undefined) ?? null
  );
  const defaultStockUnitCost = resolveStockUnitCostFromDefaultPurchasePrice({
    defaultPurchasePrice:
      (watchedDefaultPurchasePrice as string | null | undefined) ?? null,
    purchaseToStockFactor:
      (watchedPurchaseToStockFactor as string | null | undefined) ?? null,
  });
  const materialCost =
    currentStockUnitCost ??
    (defaultStockUnitCost != null ? Number.parseFloat(defaultStockUnitCost) : null);
  const sellingPrice =
    parsePositive((watchedDefaultSellingPrice as string | null | undefined) ?? null) ?? 0;
  const stockOnHand =
    parsePositive((watchedStock as string | null | undefined) ?? null) ?? 0;
  const safetyStock =
    parsePositive((watchedSafetyStock as string | null | undefined) ?? null) ?? 0;
  const marginPercent =
    sellingPrice > 0 && materialCost != null
      ? ((sellingPrice - materialCost) / sellingPrice) * 100
      : null;
  const unitProfit = materialCost != null ? Math.max(0, sellingPrice - materialCost) : null;
  const marginClass =
    marginPercent == null
      ? "text-muted-foreground"
      : marginPercent >= 30
        ? "text-success"
        : marginPercent >= 15
          ? "text-warning"
          : "text-destructive";
  const stockUnitLabel = stockingUnit?.name ?? "units";
  const itemSidebar =
    isMaster || isVariant ? null : itemType === "material" ? (
      <CreateSidebarCard
        title="Live preview"
        footer={
          safetyStock > 0 && stockOnHand < safetyStock ? (
            <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
              Stock is below safety level. Plan a purchase order.
            </div>
          ) : null
        }
      >
        <SummaryRows
          rows={[
            {
              label: "Margin",
              value: marginPercent == null ? "\u2014" : `${marginPercent.toFixed(1)}%`,
              valueClassName: marginClass,
            },
            {
              label: "Markup over cost",
              value:
                unitProfit == null
                  ? "\u2014"
                  : (formatPrice(unitProfit.toFixed(2)) ?? "$0.00"),
            },
            {
              label: "Stock on hand",
              value: `${stockOnHand} ${stockUnitLabel}`,
            },
            {
              label: "Stock value",
              value:
                materialCost == null
                  ? "\u2014"
                  : (formatPrice((stockOnHand * materialCost).toFixed(2)) ?? "$0.00"),
            },
          ]}
        />
      </CreateSidebarCard>
    ) : (
      <CreateSidebarCard
        title="Cost & margin"
        footer={
          <div className="flex w-full items-center justify-between gap-4">
            <span className="text-sm text-muted-foreground">Profit / unit</span>
            <span className="font-mono text-lg font-semibold tabular-nums">
              {unitProfit == null
                ? "\u2014"
                : (formatPrice(unitProfit.toFixed(2)) ?? "$0.00")}
            </span>
          </div>
        }
      >
        <SummaryRows
          rows={[
            {
              label: "Estimated cost",
              value:
                materialCost == null
                  ? "\u2014"
                  : (formatPrice(materialCost.toFixed(2)) ?? "$0.00"),
            },
            {
              label: "Selling price",
              value: formatPrice(sellingPrice.toFixed(2)) ?? "$0.00",
            },
            {
              label: "Margin",
              value: marginPercent == null ? "\u2014" : `${marginPercent.toFixed(1)}%`,
              valueClassName: marginClass,
            },
          ]}
        />
      </CreateSidebarCard>
    );

  return (
    <CreatePageShell>
      <CreatePageHeader
        eyebrow={`Inventory · ${itemType === "product" ? "Products" : "Materials"}`}
        title={
          isEditing
            ? isMaster
              ? "Edit Variant Master"
              : isVariant
              ? "Edit Variant"
              : `Edit ${typeLabel}`
            : isMaster
              ? "Add Variant Master"
              : `Add ${typeLabel}`
        }
        badge={
          itemType === "product" && !isEditing ? (
            <Badge variant="secondary">
              {isMaster ? "Variant master" : "Standard product"}
            </Badge>
          ) : null
        }
        actions={
          <>
          {showMasterToggle && (
            <Tooltip>
              <TooltipTrigger asChild>
                <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                  <Switch
                    checked={isMaster}
                    onCheckedChange={setIsMaster}
                  />
                  Variant master
                </label>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs">
                Create a parent row for variants with separate stock, SKU, and pricing.
              </TooltipContent>
            </Tooltip>
          )}
          <Button
            type="button"
            variant="outline"
            onClick={handleCancel}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            form="item-form"
            disabled={mutation.isPending}
          >
            {submitLabel}
          </Button>
          </>
        }
      />

      {formError && <FieldError>{formError}</FieldError>}

      <CreatePageGrid sidebar={itemSidebar}>
      <form
        id="item-form"
        onSubmit={form.handleSubmit((data) => {
          if (!mutation.isPending) mutation.mutate(data);
        }, handleInvalidSubmit)}
      >
        <FieldGroup className="gap-6">
          <CreateSection title="Basics">
            <FieldGroup>
              {isVariant ? (
                <div className="grid gap-4 md:grid-cols-2">
                  <Field>
                    <input
                      type="hidden"
                      {...form.register("name")}
                      value={variantFamilyName}
                      readOnly
                    />
                    <FieldLabel htmlFor="variant-family-name">Master Name</FieldLabel>
                    <Input
                      id="variant-family-name"
                      value={variantFamilyName}
                      readOnly
                      className="bg-muted/40 text-muted-foreground"
                    />
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="variant-title">Variant Title</FieldLabel>
                    <Input
                      id="variant-title"
                      value={variantTitle}
                      readOnly
                      className="bg-muted/40 font-medium"
                    />
                  </Field>
                </div>
              ) : (
                <Controller
                  name="name"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor={field.name}>Name</FieldLabel>
                      <Input
                        {...field}
                        id={field.name}
                        value={field.value ?? ""}
                        aria-invalid={fieldState.invalid}
                        placeholder="e.g. Sand, Gravel, Topsoil"
                        autoComplete="off"
                      />
                      {fieldState.invalid && (
                        <FieldError errors={[fieldState.error]} />
                      )}
                    </Field>
                  )}
                />
              )}

              <Controller
                name="description"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor={field.name}>Description</FieldLabel>
                    <Textarea
                      {...field}
                      id={field.name}
                      value={field.value ?? ""}
                      aria-invalid={fieldState.invalid}
                      placeholder={`Optional notes about this ${typeLabel.toLowerCase()}`}
                      rows={3}
                      autoComplete="off"
                    />
                    {fieldState.invalid && (
                      <FieldError errors={[fieldState.error]} />
                    )}
                  </Field>
                )}
              />


              <div className="grid gap-4 md:grid-cols-2">
                {!isMaster && (
                  <Controller
                    name="sku"
                    control={form.control}
                    render={({ field, fieldState }) => (
                      <Field data-invalid={fieldState.invalid}>
                        <FieldLabel htmlFor={field.name}>
                          <TooltipHeader label="SKU" tooltip={ITEM_SKU_TOOLTIP} />
                        </FieldLabel>
                        <Input
                          {...field}
                          id={field.name}
                          value={field.value ?? ""}
                          aria-invalid={fieldState.invalid}
                          placeholder={itemType === "product" ? "PRD-001" : "MAT-001"}
                          autoComplete="off"
                        />
                        {fieldState.invalid && (
                          <FieldError errors={[fieldState.error]} />
                        )}
                      </Field>
                    )}
                  />
                )}

                <Controller
                  name="category"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor={field.name}>
                        <TooltipHeader label="Category" tooltip={ITEM_CATEGORY_TOOLTIP} />
                      </FieldLabel>
                      <Combobox
                        items={categoryItems}
                        value={field.value ?? ""}
                        onValueChange={(v) => field.onChange(v || null)}
                        onInputValueChange={setCategoryInput}
                      >
                        <ComboboxInput
                          placeholder="Search or create category..."
                        />
                        <ComboboxContent>
                          <ComboboxEmpty>
                            Type to create a new category
                          </ComboboxEmpty>
                          <ComboboxList>
                            {(item: string) => (
                              <ComboboxItem key={item} value={item}>
                                {categoriesSet.has(item.toLowerCase())
                                  ? item
                                  : `+ Create "${item}"`}
                              </ComboboxItem>
                            )}
                          </ComboboxList>
                        </ComboboxContent>
                      </Combobox>
                      {fieldState.invalid && (
                        <FieldError errors={[fieldState.error]} />
                      )}
                    </Field>
                  )}
                />
              </div>

              {!isMaster && initialData ? (
                <Field>
                  <FieldLabel>
                    <TooltipHeader label="Stocking Unit" tooltip={STOCKING_UNIT_TOOLTIP} />
                  </FieldLabel>
                  <p className="py-2 text-sm">
                    {initialData.unitName} ({initialData.unitSize} {initialData.unitUom})
                  </p>
                </Field>
              ) : !isMaster ? (
                <Controller
                  name="unitDefinitionId"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor={field.name}>
                        <TooltipHeader label="Stocking Unit" tooltip={STOCKING_UNIT_TOOLTIP} />
                      </FieldLabel>
                      <Select
                        key={field.value as string}
                        name={field.name}
                        value={field.value as string}
                        onValueChange={(value) => {
                          if (value === CREATE_NEW_UNIT) {
                            setIsUnitDialogOpen(true);
                          } else {
                            field.onChange(value);
                          }
                        }}
                      >
                        <SelectTrigger
                          id={field.name}
                          aria-invalid={fieldState.invalid}
                          className="w-full"
                        >
                          <SelectValue placeholder="Select a stocking unit" />
                        </SelectTrigger>
                        <SelectContent>
                          {localUnits.map((u) => (
                            <SelectItem key={u.id} value={u.id}>
                              {u.name} ({u.size} {u.uom})
                            </SelectItem>
                          ))}
                          <SelectSeparator />
                          <SelectItem value={CREATE_NEW_UNIT}>
                            + Create new unit
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      {fieldState.invalid && (
                        <FieldError errors={[fieldState.error]} />
                      )}
                    </Field>
                  )}
                />
              ) : null}

              {!isMaster && (
                <Controller
                  name="purchaseUnitDefinitionId"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor={field.name}>
                        <TooltipHeader label="Purchase Unit" tooltip={PURCHASE_UNIT_TOOLTIP} />
                      </FieldLabel>
                      <Select
                        name={field.name}
                        value={(field.value as string | null) ?? "__none__"}
                        onValueChange={(value) => {
                          field.onChange(value === "__none__" ? null : value);
                        }}
                      >
                        <SelectTrigger
                          id={field.name}
                          aria-invalid={fieldState.invalid}
                          className="w-full"
                        >
                          <SelectValue placeholder="Purchased in stocking units" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">Purchased in stocking units</SelectItem>
                          <SelectSeparator />
                          {localUnits.map((u) => (
                            <SelectItem key={u.id} value={u.id}>
                              {u.name} ({u.size} {u.uom})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {fieldState.invalid && (
                        <FieldError errors={[fieldState.error]} />
                      )}
                    </Field>
                  )}
                />
              )}

              {itemType === "product" && !isMaster && (
                <Controller
                  name="sellable"
                  control={form.control}
                  render={({ field }) => (
                    <Field orientation="horizontal">
                      <Switch
                        id={field.name}
                        checked={field.value ?? true}
                        onCheckedChange={field.onChange}
                      />
                      <div className="flex flex-col gap-1">
                        <FieldLabel htmlFor={field.name}>Sellable</FieldLabel>
                      </div>
                    </Field>
                  )}
                />
              )}

              {!isMaster && purchaseUnit && stockingUnit && derivedPurchaseFactor != null ? (
                <Field>
                  <FieldLabel>
                    <TooltipHeader
                      label="Purchase Conversion"
                      tooltip={PURCHASE_CONVERSION_TOOLTIP}
                    />
                  </FieldLabel>
                  <p className="py-2 text-sm text-muted-foreground">
                    1 {purchaseUnit.name} = {derivedPurchaseFactor} {stockingUnit.name}
                  </p>
                </Field>
              ) : null}

              {!isMaster && purchaseUnit && stockingUnit && derivedPurchaseFactor == null ? (
                <Controller
                  name="purchaseToStockFactor"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor={field.name}>
                        <TooltipHeader
                          label="Stocking Units per 1 Purchase Unit"
                          tooltip={PURCHASE_CONVERSION_TOOLTIP}
                        />
                      </FieldLabel>
                      <Input
                        {...field}
                        id={field.name}
                        value={(field.value as string | null) ?? ""}
                        onChange={(event) => field.onChange(event.target.value || null)}
                        aria-invalid={fieldState.invalid}
                        placeholder={`How many ${stockingUnit.name} per 1 ${purchaseUnit.name}?`}
                        inputMode="decimal"
                        autoComplete="off"
                      />
                      {fieldState.invalid && (
                        <FieldError errors={[fieldState.error]} />
                      )}
                    </Field>
                  )}
                />
              ) : null}
            </FieldGroup>
          </CreateSection>

          {isMaster && (
            <CreateSection
              title="Variant axes"
            >
                <FieldGroup>
                  <Controller
                    name="variantAxes"
                    control={form.control}
                    render={({ field, fieldState }) => (
                      <Field data-invalid={fieldState.invalid}>
                        <FieldLabel>Axes</FieldLabel>
                        <AxesInput
                          value={(field.value as string[]) ?? []}
                          onChange={field.onChange}
                        />
                        {fieldState.invalid && (
                          <FieldError errors={[fieldState.error as { message?: string } | undefined]} />
                        )}
                      </Field>
                    )}
                  />
                </FieldGroup>
            </CreateSection>
          )}

          {!isMaster && (
          <CreateSection
            title="Pricing & stock"
          >
            <FieldGroup>
              <div className="grid gap-4 md:grid-cols-2">
                {itemType === "material" && (
                  <Controller
                    name="defaultPurchasePrice"
                    control={form.control}
                    render={({ field, fieldState }) => (
                      <Field data-invalid={fieldState.invalid}>
                        <FieldLabel htmlFor={field.name}>
                          <TooltipHeader label="Purchase Price" tooltip={PURCHASE_PRICE_TOOLTIP} />
                        </FieldLabel>
                        <Input
                          {...field}
                          id={field.name}
                          value={field.value ?? ""}
                          aria-invalid={fieldState.invalid}
                          placeholder="0.00"
                          inputMode="decimal"
                          autoComplete="off"
                        />
                        <FieldDescription>
                          {purchaseUnit
                            ? `Per ${purchaseUnit.name}; converts to ${stockingUnit?.name ?? "stock"} cost.`
                            : `Per ${stockingUnit?.name ?? "stock"} unit.`}
                        </FieldDescription>
                        {fieldState.invalid && (
                          <FieldError errors={[fieldState.error]} />
                        )}
                      </Field>
                    )}
                  />
                )}

                {itemType === "material" && (
                  <Controller
                    name="currentStockUnitCost"
                    control={form.control}
                    render={({ field, fieldState }) => (
                      <Field data-invalid={fieldState.invalid}>
                        <FieldLabel htmlFor={field.name}>
                          <TooltipHeader
                            label="Current Stock Unit Cost"
                            tooltip={CURRENT_STOCK_UNIT_COST_TOOLTIP}
                          />
                        </FieldLabel>
                        <Input
                          {...field}
                          id={field.name}
                          value={field.value ?? ""}
                          onChange={(event) => field.onChange(event.target.value || null)}
                          aria-invalid={fieldState.invalid}
                          placeholder="0.00"
                          inputMode="decimal"
                          autoComplete="off"
                          readOnly={isEditing}
                          className={isEditing ? "bg-muted/40 text-muted-foreground" : undefined}
                        />
                        <FieldDescription>
                          Auto-updated from stock and receipts.
                        </FieldDescription>
                        {isEditing && (
                          <div className="pt-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setCurrentStockUnitCostDraft(
                                  ((form.getValues("currentStockUnitCost" as never) as unknown as string | null) ??
                                    "")
                                );
                                setCurrentStockUnitCostError(null);
                                setCurrentStockUnitCostDialogOpen(true);
                              }}
                            >
                              Override current stock unit cost
                            </Button>
                          </div>
                        )}
                        {fieldState.invalid && (
                          <FieldError errors={[fieldState.error]} />
                        )}
                      </Field>
                    )}
                  />
                )}

                {itemType === "material" && (
                  <Controller
                    name="xeroPurchaseAccountCode"
                    control={form.control}
                    render={({ field, fieldState }) => (
                      <Field data-invalid={fieldState.invalid}>
                        <FieldLabel htmlFor={field.name}>
                          Xero Purchase Account
                        </FieldLabel>
                        {xeroAccounts.length > 0 ? (
                          <Select
                            value={field.value ?? "__default__"}
                            onValueChange={(value) =>
                              field.onChange(value === "__default__" ? null : value)
                            }
                          >
                            <SelectTrigger
                              id={field.name}
                              className="w-full"
                              aria-invalid={fieldState.invalid}
                            >
                              <SelectValue placeholder="Select account" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__default__">Use PO default</SelectItem>
                              {xeroAccounts.map((account) => (
                                <SelectItem key={account.code} value={account.code}>
                                  {account.code} · {account.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <Input
                            {...field}
                            id={field.name}
                            value={field.value ?? ""}
                            onChange={(event) =>
                              field.onChange(event.target.value || null)
                            }
                            aria-invalid={fieldState.invalid}
                            placeholder="Account code"
                            autoComplete="off"
                          />
                        )}
                        {fieldState.invalid && (
                          <FieldError errors={[fieldState.error]} />
                        )}
                      </Field>
                    )}
                  />
                )}

                <Controller
                  name="defaultSellingPrice"
                  control={form.control}
                  render={({ field, fieldState }) => (
                      <Field data-invalid={fieldState.invalid}>
                        <FieldLabel htmlFor={field.name}>
                          <TooltipHeader label="Selling Price" tooltip={SELLING_PRICE_TOOLTIP} />
                        </FieldLabel>
                      <Input
                        {...field}
                        id={field.name}
                        value={field.value ?? ""}
                        aria-invalid={fieldState.invalid}
                        placeholder="0.00"
                        inputMode="decimal"
                        autoComplete="off"
                      />
                      {fieldState.invalid && (
                        <FieldError errors={[fieldState.error]} />
                      )}
                    </Field>
                  )}
                />

                <Controller
                  name="stock"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor={field.name}>
                        <TooltipHeader label="Stock" tooltip={ON_HAND_STOCK_TOOLTIP} />
                      </FieldLabel>
                      <Input
                        {...field}
                        id={field.name}
                        value={field.value ?? ""}
                        aria-invalid={fieldState.invalid}
                        placeholder="0"
                        inputMode="decimal"
                        autoComplete="off"
                      />
                      {fieldState.invalid && (
                        <FieldError errors={[fieldState.error]} />
                      )}
                    </Field>
                  )}
                />

                <Controller
                  name="safetyStock"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor={field.name}>
                        <TooltipHeader label="Safety Stock" tooltip={SAFETY_STOCK_TOOLTIP} />
                      </FieldLabel>
                      <Input
                        {...field}
                        id={field.name}
                        value={field.value ?? ""}
                        aria-invalid={fieldState.invalid}
                        placeholder="0"
                        inputMode="decimal"
                        autoComplete="off"
                      />
                      {fieldState.invalid && (
                        <FieldError errors={[fieldState.error]} />
                      )}
                    </Field>
                  )}
                />
              </div>
            </FieldGroup>
          </CreateSection>
          )}

          {itemType === "product" && availableComponents && !isMaster && (
            <CreateSection
              title="Recipe / Bill of Materials"
              action={
                <div className="flex items-center gap-2">
                    <Controller
                      control={form.control}
                      name="manufacturingMode"
                      render={({ field }) => (
                        <ToggleGroup
                          type="single"
                          variant="outline"
                          size="sm"
                          value={field.value ?? "discrete"}
                          onValueChange={(value) => {
                            if (!value) return;
                            field.onChange(value);
                            if (value === "discrete") {
                              form.setValue("expectedBatchYield", null, {
                                shouldDirty: true,
                              });
                            }
                          }}
                        >
                          <ToggleGroupItem value="discrete">Discrete</ToggleGroupItem>
                          <ToggleGroupItem value="batch">Batch</ToggleGroupItem>
                        </ToggleGroup>
                      )}
                    />
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            className="shrink-0"
                            aria-label={bomLocked ? "Unlock recipe" : "Lock recipe"}
                            disabled={!canManageBomLock}
                            onClick={() => {
                              setPendingBomLocked(!bomLocked);
                              setBomLockConfirmOpen(true);
                            }}
                          >
                            <HugeiconsIcon
                              icon={bomLocked ? CircleLock01Icon : CircleUnlock01Icon}
                              strokeWidth={2}
                            />
                          </Button>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        {canManageBomLock
                          ? bomLocked
                            ? "Locked. Click to unlock."
                            : "Unlocked. Click to lock."
                          : "Inventory admin access required."}
                      </TooltipContent>
                    </Tooltip>
                  </div>
              }
            >
                {watchedManufacturingMode === "batch" && (
                  <Controller
                    control={form.control}
                    name="expectedBatchYield"
                    render={({ field, fieldState }) => (
                      <Field data-invalid={fieldState.invalid}>
                        <FieldLabel htmlFor={field.name}>
                          <TooltipHeader
                            label="Expected Batch Yield"
                            tooltip={BATCH_YIELD_TOOLTIP}
                          />
                        </FieldLabel>
                        <Input
                          {...field}
                          id={field.name}
                          value={field.value ?? ""}
                          aria-invalid={fieldState.invalid}
                          inputMode="decimal"
                          autoComplete="off"
                          placeholder="0"
                          className="w-48"
                        />
                        {fieldState.invalid ? (
                          <FieldError errors={[fieldState.error]} />
                        ) : null}
                      </Field>
                    )}
                  />
                )}
                <BomEditor
                  control={form.control as Parameters<typeof BomEditor>[0]["control"]}
                  availableComponents={availableComponents}
                  manufacturingMode={watchedManufacturingMode ?? "discrete"}
                />
                {isBomDirty ? (
                  <FieldGroup>
                    <Field>
                      <FieldDescription>
                        Creates a new BOM revision on save.
                      </FieldDescription>
                    </Field>
                    <Controller
                      name="revisionNote"
                      control={form.control}
                      render={({ field, fieldState }) => (
                        <Field data-invalid={fieldState.invalid}>
                          <FieldLabel htmlFor={field.name}>Revision Note</FieldLabel>
                          <Textarea
                            {...field}
                            id={field.name}
                            value={field.value ?? ""}
                            onChange={(event) => field.onChange(event.target.value || null)}
                            aria-invalid={fieldState.invalid}
                            placeholder="Optional note about what changed in this recipe"
                            rows={2}
                            autoComplete="off"
                          />
                          {fieldState.invalid ? (
                            <FieldError errors={[fieldState.error]} />
                          ) : null}
                        </Field>
                      )}
                    />
                  </FieldGroup>
                ) : null}
            </CreateSection>
          )}
        </FieldGroup>
      </form>
      <BomLockConfirmDialog
        open={bomLockConfirmOpen}
        onOpenChange={(open) => {
          setBomLockConfirmOpen(open);
          if (!open) {
            setPendingBomLocked(null);
          }
        }}
        title={lockDialogTitle}
        description={lockDialogDescription}
        confirmLabel={lockTarget ? "Lock BOM" : "Unlock BOM"}
        onConfirm={() => {
          if (pendingBomLocked == null) return;

          form.setValue("bomLocked", pendingBomLocked, {
            shouldDirty: true,
            shouldTouch: true,
          });
          setPendingBomLocked(null);
        }}
      />
      <CurrentStockCostDialog
        open={currentStockUnitCostDialogOpen}
        onOpenChange={(open) => {
          setCurrentStockUnitCostDialogOpen(open);
          if (!open) {
            setCurrentStockUnitCostError(null);
            setCurrentStockUnitCostDraft(
              ((form.getValues("currentStockUnitCost" as never) as unknown as string | null) ??
                "")
            );
          }
        }}
        value={currentStockUnitCostDraft}
        onValueChange={setCurrentStockUnitCostDraft}
        error={currentStockUnitCostError}
        isPending={currentStockUnitCostMutation.isPending}
        onConfirm={() => currentStockUnitCostMutation.mutate()}
      />
      <CreateUnitDialog
        open={isUnitDialogOpen}
        onOpenChange={(open) => {
          setIsUnitDialogOpen(open);
          if (!open) {
            resetUnitForm();
            setUnitError(null);
          }
        }}
        name={unitName}
        onNameChange={setUnitName}
        size={unitSize}
        onSizeChange={setUnitSize}
        uom={unitUom}
        onUomChange={setUnitUom}
        uomGroups={uomGroups}
        sizeInvalid={unitSizeInvalid}
        error={unitError}
        isPending={unitMutation.isPending}
        canSubmit={
          !unitMutation.isPending &&
          Boolean(unitName.trim()) &&
          POSITIVE_NUMBER_RE.test(unitSize.trim()) &&
          Boolean(unitUom)
        }
        onSubmit={() => unitMutation.mutate()}
      />
      </CreatePageGrid>
    </CreatePageShell>
  );
}
