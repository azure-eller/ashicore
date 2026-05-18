"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { useSmartBack } from "@/lib/hooks/use-smart-back";
import { apiJson } from "@/lib/client/api";
import { Controller, useForm, useWatch, type UseFormSetValue } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import { Checkbox } from "@/components/ui/checkbox";
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
import { Badge } from "@/components/ui/badge";
import { EditableLineGridCell } from "@/components/editable-line-grid";
import { EditableLineItems } from "@/components/editable-line-items";
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
  manufacturingResources?: Array<{
    id: string;
    name: string;
    resourceType: string;
    loadedCostPerHour: string;
  }>;
  canManageBomLock?: boolean;
  initialData?: NonNullable<Awaited<ReturnType<typeof getItem>>> & {
    bom?: {
      componentId: string;
      quantity: string | null;
      minimumLotAgeDays?: number | null;
      alternates?: Array<{ itemId: string }>;
    }[];
    operationCosts?: {
      operationName: string;
      resourceId: string;
      costScalingMode: "per_output_unit" | "fixed_per_mo";
      crewSize: string;
      plannedMinutes: string;
      loadedCostPerHour?: string | null;
    }[];
  };
}

type ItemFormValues = InsertItemFormValues | UpdateItemFormValues | InsertMasterItemFormValues;
type ItemMutationResult = { id: string };
type CurrentStockUnitCostResult = { id: string; currentStockUnitCost: string | null };
type UnitDefinitionResult = { id: string; name: string; size: string; uom: string };

type ManufacturingResourceOption = NonNullable<ItemFormProps["manufacturingResources"]>[number];

function formatOperationCost(params: {
  crewSize: string | null | undefined;
  plannedMinutes: string | null | undefined;
  loadedCostPerHour: string | null | undefined;
  costScalingMode: string | null | undefined;
  expectedBatchYield: string | null | undefined;
  typicalBatchSize: string | null | undefined;
  standardCostQuantity: string | null | undefined;
}) {
  const crewSize = Number(params.crewSize);
  const plannedMinutes = Number(params.plannedMinutes);
  const loadedCostPerHour = Number(params.loadedCostPerHour);
  if (
    !Number.isFinite(crewSize) ||
    !Number.isFinite(plannedMinutes) ||
    !Number.isFinite(loadedCostPerHour) ||
    crewSize <= 0 ||
    plannedMinutes <= 0
  ) {
    return "—";
  }

  const total = (crewSize * plannedMinutes * loadedCostPerHour) / 60;
  if (params.costScalingMode === "fixed_per_mo") {
    const costQuantity =
      params.expectedBatchYield ?? params.typicalBatchSize ?? params.standardCostQuantity;
    const quantity = Number(costQuantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return `${formatPrice(total.toFixed(2)) ?? "$0"} per MO`;
    }
    return `${formatPrice((total / quantity).toFixed(2)) ?? "$0"} / unit`;
  }

  return `${formatPrice(total.toFixed(2)) ?? "$0"} / unit`;
}

const OPERATION_COST_GRID_COLUMNS =
  "minmax(12rem,1.2fr) minmax(10rem,1fr) minmax(8rem,.75fr) minmax(7rem,.65fr) minmax(9rem,.75fr) minmax(7rem,.65fr)";

const blankOperationCostLine = {
  operationName: "",
  resourceId: "",
  costScalingMode: "per_output_unit" as const,
  crewSize: null,
  plannedMinutes: null,
  loadedCostPerHour: null,
};

function OperationCostEditor({
  control,
  setValue,
  resources,
  expectedBatchYield,
  typicalBatchSize,
  standardCostQuantity,
}: {
  control: ReturnType<typeof useForm<ItemFormValues>>["control"];
  setValue: UseFormSetValue<ItemFormValues>;
  resources: ManufacturingResourceOption[];
  expectedBatchYield: string | null | undefined;
  typicalBatchSize: string | null | undefined;
  standardCostQuantity: string | null | undefined;
}) {
  const operationCosts =
    (useWatch({ control, name: "operationCosts" as never }) as
      | Array<{
          resourceId?: string | null;
          costScalingMode?: string | null;
          crewSize?: string | null;
          plannedMinutes?: string | null;
          loadedCostPerHour?: string | null;
        }>
      | undefined) ?? [];
  const resourcesById = useMemo(
    () => new Map(resources.map((resource) => [resource.id, resource])),
    [resources]
  );

  return (
    <EditableLineItems<ItemFormValues, "operationCosts">
      control={control}
      name={"operationCosts" as never}
      columns={OPERATION_COST_GRID_COLUMNS}
      minWidth="62rem"
      createLine={() => ({ ...blankOperationCostLine }) as never}
      addLabel="Add operation cost"
      emptyMessage="No operation costs yet."
      headers={["Operation", "Resource", "Mode", "Crew", "Minutes", "Cost"]}
      renderRow={({ field, index, appendLineAfterCommit }) => (
        <OperationCostRow
          key={field.id}
          index={index}
          control={control}
          resources={resources}
          resourcesById={resourcesById}
          row={operationCosts[index]}
          setValue={setValue}
          expectedBatchYield={expectedBatchYield}
          typicalBatchSize={typicalBatchSize}
          standardCostQuantity={standardCostQuantity}
          appendLineAfterCommit={appendLineAfterCommit}
        />
      )}
    />
  );
}

function OperationCostRow({
  index,
  control,
  resources,
  resourcesById,
  row,
  setValue,
  expectedBatchYield,
  typicalBatchSize,
  standardCostQuantity,
  appendLineAfterCommit,
}: {
  index: number;
  control: ReturnType<typeof useForm<ItemFormValues>>["control"];
  resources: ManufacturingResourceOption[];
  resourcesById: Map<string, ManufacturingResourceOption>;
  row:
    | {
        resourceId?: string | null;
        costScalingMode?: string | null;
        crewSize?: string | null;
        plannedMinutes?: string | null;
        loadedCostPerHour?: string | null;
      }
    | undefined;
  setValue: UseFormSetValue<ItemFormValues>;
  expectedBatchYield: string | null | undefined;
  typicalBatchSize: string | null | undefined;
  standardCostQuantity: string | null | undefined;
  appendLineAfterCommit: () => void;
}) {
  const rowDomId = useId();
  const resource = row?.resourceId ? resourcesById.get(row.resourceId) : null;
  const previewRate = row?.loadedCostPerHour ?? resource?.loadedCostPerHour;
  const minutesLabel =
    row?.costScalingMode === "fixed_per_mo"
      ? "Minutes per manufacturing order"
      : "Minutes per finished unit";

  return (
    <>
      <EditableLineGridCell>
        <Controller
          control={control}
          name={`operationCosts.${index}.operationName` as never}
          render={({ field: inputField, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel className="sr-only" htmlFor={`${rowDomId}-name`}>
                Operation
              </FieldLabel>
              <Input
                {...inputField}
                id={`${rowDomId}-name`}
                value={(inputField.value as string | null) ?? ""}
                aria-invalid={fieldState.invalid}
                autoComplete="off"
                className="w-full min-w-0"
                data-editable-line-primary
              />
              {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
            </Field>
          )}
        />
      </EditableLineGridCell>
      <EditableLineGridCell>
        <Controller
          control={control}
          name={`operationCosts.${index}.resourceId` as never}
          render={({ field: inputField, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel className="sr-only">Resource</FieldLabel>
              <Select
                value={(inputField.value as string | null) ?? ""}
                onValueChange={(value) => {
                  inputField.onChange(value);
                  setValue(
                    `operationCosts.${index}.loadedCostPerHour` as never,
                    (resourcesById.get(value)?.loadedCostPerHour ?? null) as never,
                    { shouldDirty: false, shouldTouch: false }
                  );
                  if (value) {
                    appendLineAfterCommit();
                  }
                }}
              >
                <SelectTrigger aria-invalid={fieldState.invalid} className="w-full min-w-0">
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  {resources.map((resourceOption) => (
                    <SelectItem key={resourceOption.id} value={resourceOption.id}>
                      {resourceOption.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
            </Field>
          )}
        />
      </EditableLineGridCell>
      <EditableLineGridCell>
        <Controller
          control={control}
          name={`operationCosts.${index}.costScalingMode` as never}
          render={({ field: inputField, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel className="sr-only">Mode</FieldLabel>
              <Select
                value={(inputField.value as string | null) ?? "per_output_unit"}
                onValueChange={inputField.onChange}
              >
                <SelectTrigger aria-invalid={fieldState.invalid} className="w-full min-w-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="per_output_unit">Per unit</SelectItem>
                  <SelectItem value="fixed_per_mo">Per MO</SelectItem>
                </SelectContent>
              </Select>
              {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
            </Field>
          )}
        />
      </EditableLineGridCell>
      <EditableLineGridCell>
        <Controller
          control={control}
          name={`operationCosts.${index}.crewSize` as never}
          render={({ field: inputField, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel className="sr-only" htmlFor={`${rowDomId}-crew-size`}>
                Crew size
              </FieldLabel>
              <Input
                {...inputField}
                id={`${rowDomId}-crew-size`}
                value={(inputField.value as string | null) ?? ""}
                aria-invalid={fieldState.invalid}
                inputMode="decimal"
                autoComplete="off"
                className="w-full min-w-0"
              />
              {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
            </Field>
          )}
        />
      </EditableLineGridCell>
      <EditableLineGridCell>
        <Controller
          control={control}
          name={`operationCosts.${index}.plannedMinutes` as never}
          render={({ field: inputField, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel className="sr-only" htmlFor={`${rowDomId}-minutes`}>
                {minutesLabel}
              </FieldLabel>
              <Input
                {...inputField}
                id={`${rowDomId}-minutes`}
                value={(inputField.value as string | null) ?? ""}
                aria-invalid={fieldState.invalid}
                inputMode="decimal"
                autoComplete="off"
                className="w-full min-w-0"
              />
              {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
            </Field>
          )}
        />
      </EditableLineGridCell>
      <EditableLineGridCell className="text-[length:var(--text-sm)] text-muted-foreground">
        {formatOperationCost({
          crewSize: row?.crewSize,
          plannedMinutes: row?.plannedMinutes,
          loadedCostPerHour: previewRate,
          costScalingMode: row?.costScalingMode,
          expectedBatchYield,
          typicalBatchSize,
          standardCostQuantity,
        })}
      </EditableLineGridCell>
    </>
  );
}

export function ItemForm({
  itemType,
  units,
  categories,
  availableComponents,
  manufacturingResources = [],
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
          currentStockUnitCost: initialData.currentStockUnitCost,
          defaultSellingPrice: initialData.defaultSellingPrice,
          sellable: initialData.sellable ?? true,
          manufacturingMode: "discrete" as const,
          expectedBatchYield: initialData.expectedBatchYield,
          typicalBatchSize: initialData.typicalBatchSize,
          typicalGroupSize: initialData.typicalGroupSize,
          standardCostQuantity: initialData.standardCostQuantity,
          bomLocked: initialData.bomLocked ?? false,
          stock: initialData.stock,
          safetyStock: initialData.safetyStock,
          bom: initialData.bom ?? [],
          operationCosts: initialData.operationCosts ?? [],
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
            currentStockUnitCost: null,
            defaultSellingPrice: null,
            sellable: false,
            manufacturingMode: "discrete" as const,
            expectedBatchYield: null,
            typicalBatchSize: null,
            typicalGroupSize: null,
            standardCostQuantity: null,
            bomLocked: false,
            stock: "0",
            safetyStock: "0",
            bom: [],
            operationCosts: [],
            revisionNote: null,
          },
  });

  const [formError, setFormError] = useState<string | null>(null);
  const [unitError, setUnitError] = useState<string | null>(null);
  const bomLocked = useWatch({
    control: form.control,
    name: "bomLocked",
  });
  const watchedTypicalBatchSize = useWatch({
    control: form.control,
    name: "typicalBatchSize",
  });
  const watchedExpectedBatchYield = useWatch({
    control: form.control,
    name: "expectedBatchYield",
  });
  const watchedTypicalGroupSize = useWatch({
    control: form.control,
    name: "typicalGroupSize",
  });
  const watchedStandardCostQuantity = useWatch({
    control: form.control,
    name: "standardCostQuantity",
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
  const isBomDirty =
    itemType === "product" &&
    !isMaster &&
    Boolean(
      (form.formState.dirtyFields as Record<string, unknown>).bom ||
        (form.formState.dirtyFields as Record<string, unknown>).operationCosts
    );
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
                      <Checkbox
                        id={field.name}
                        checked={field.value ?? false}
                        onCheckedChange={(checked) => field.onChange(checked === true)}
                      />
                      <FieldLabel htmlFor={field.name}>Sellable</FieldLabel>
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
                <FieldGroup>
                  <div className="grid gap-4 md:grid-cols-3">
                    <Controller
                      control={form.control}
                      name="typicalBatchSize"
                      render={({ field, fieldState }) => (
                        <Field data-invalid={fieldState.invalid}>
                          <FieldLabel htmlFor={field.name}>
                            Typical Batch Size
                          </FieldLabel>
                          <Input
                            {...field}
                            id={field.name}
                            value={field.value ?? ""}
                            aria-invalid={fieldState.invalid}
                            inputMode="decimal"
                            autoComplete="off"
                            placeholder="0"
                          />
                          {fieldState.invalid ? (
                            <FieldError errors={[fieldState.error]} />
                          ) : null}
                        </Field>
                      )}
                    />
                    <Controller
                      control={form.control}
                      name="typicalGroupSize"
                      render={({ field, fieldState }) => (
                        <Field data-invalid={fieldState.invalid}>
                          <FieldLabel htmlFor={field.name}>
                            Typical Group Size
                          </FieldLabel>
                          <Input
                            {...field}
                            id={field.name}
                            value={field.value ?? ""}
                            aria-invalid={fieldState.invalid}
                            inputMode="decimal"
                            autoComplete="off"
                            placeholder="0"
                          />
                          {fieldState.invalid ? (
                            <FieldError errors={[fieldState.error]} />
                          ) : null}
                        </Field>
                      )}
                    />
                    <Controller
                      control={form.control}
                      name="standardCostQuantity"
                      render={({ field, fieldState }) => (
                        <Field data-invalid={fieldState.invalid}>
                          <FieldLabel htmlFor={field.name}>
                            Standard Costing Quantity
                          </FieldLabel>
                          <Input
                            {...field}
                            id={field.name}
                            value={field.value ?? ""}
                            aria-invalid={fieldState.invalid}
                            inputMode="decimal"
                            autoComplete="off"
                            placeholder="0"
                          />
                          {fieldState.invalid ? (
                            <FieldError errors={[fieldState.error]} />
                          ) : null}
                        </Field>
                      )}
                    />
                  </div>
                </FieldGroup>
                <div className="space-y-(--space-4)">
                  <h3 className="text-[length:var(--text-base)] font-semibold">Materials</h3>
                  <BomEditor
                    control={form.control as Parameters<typeof BomEditor>[0]["control"]}
                    setValue={form.setValue as Parameters<typeof BomEditor>[0]["setValue"]}
                    availableComponents={availableComponents}
                    typicalBatchSize={watchedTypicalBatchSize}
                    typicalGroupSize={watchedTypicalGroupSize}
                  />
                </div>
                <div className="space-y-(--space-4)">
                  <h3 className="text-[length:var(--text-base)] font-semibold">
                    Standard Operation Costs
                  </h3>
                  <OperationCostEditor
                    control={form.control}
                    setValue={form.setValue}
                    resources={manufacturingResources}
                    expectedBatchYield={watchedExpectedBatchYield}
                    typicalBatchSize={watchedTypicalBatchSize}
                    standardCostQuantity={watchedStandardCostQuantity}
                  />
                </div>
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
