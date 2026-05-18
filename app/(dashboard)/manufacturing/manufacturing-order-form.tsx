"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useSmartBack } from "@/lib/hooks/use-smart-back";
import {
  Controller,
  type Resolver,
  useFieldArray,
  useForm,
  useWatch,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  manufacturingOrderCreateFormSchema,
  manufacturingOrderDefaultValues,
  updateManufacturingOrderSchema,
  type ManufacturingOrderCreateFormValues,
} from "@/lib/schemas/manufacturing-orders";
import { Button } from "@/components/ui/button";
import {
  CreatePageGrid,
  CreatePageHeader,
  CreatePageShell,
  CreateSection,
  CreateSidebarCard,
  SummaryRows,
} from "@/components/create-page";
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
import {
  EditableLineGrid,
  EditableLineGridCell,
  EditableLineGridRemoveButton,
  EditableLineGridRow,
} from "@/components/editable-line-grid";
import { InventoryItemCombobox } from "@/components/inventory-item-combobox";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { TooltipHeader } from "@/components/tooltip-header";
import { useOrganizationTimeZone } from "@/components/time-zone-provider";
import {
  formatQuantity,
  getFieldArrayError,
  getFirstFormErrorMessage,
  normalizeNumeric,
  todayInTimeZone,
} from "@/lib/format";
import {
  calculateConsumptionRequirement,
  makeGroupChoiceKey,
  summarizeGroupRemainders,
  type BatchScalingMode,
  type ConsumptionMode,
  type GroupRemainderHandling,
  type GroupRemainderChoice,
  type GroupRemainderPolicy,
} from "@/lib/manufacturing/consumption";
import {
  BOM_QTY_PER_UNIT_TOOLTIP,
  MANUFACTURING_PLANNED_TOTAL_TOOLTIP,
  MANUFACTURING_PLANNED_QTY_TOOLTIP,
  MANUFACTURING_SALES_ORDER_TOOLTIP,
  SALES_LINE_QTY_TOOLTIP,
  UNIT_TOOLTIP,
} from "@/lib/tooltip-copy";
import type {
  ManufacturingOrderEditData,
  ManufacturingProductOption,
  ManufacturingSalesLineOption,
  ManufacturingSalesOrderOption,
  ManufacturingSalesOrderPreview,
} from "./types";

type ManufacturingProductTemplate = ManufacturingProductOption & {
  bom: Array<{
    itemId: string;
    itemName: string;
    itemSku: string | null;
    itemType: string;
    unitName: string;
    quantityPerUnit: string;
    consumptionMode: string;
    basisOutputQuantity: string | null;
    batchScalingMode: string | null;
    groupRemainderPolicy: string | null;
    scalingReviewRecommended: boolean;
    defaultItemId?: string | null;
    defaultItemName?: string | null;
    defaultItemSku?: string | null;
    defaultUnitName?: string | null;
    defaultQuantityPerUnit: string;
    alternates: Array<{
      itemId: string;
      itemName: string;
      itemSku: string | null;
      itemType: string;
      unitName: string;
      quantityFactor: string;
      sortOrder: number;
    }>;
  }>;
};

type ManufacturingOrderFormValues = ManufacturingOrderCreateFormValues;

const MANUFACTURING_INGREDIENT_GRID_COLUMNS =
  "minmax(14rem, 1.5fr) minmax(7rem, 0.7fr) minmax(7rem, 0.7fr) minmax(5.5rem, 0.5fr) 2.25rem";

function isBlankManufacturingIngredient(
  ingredient: ManufacturingOrderFormValues["ingredients"][number] | undefined
) {
  const itemId = ingredient?.itemId?.trim() ?? "";
  const quantityPerUnit = ingredient?.quantityPerUnit?.trim() ?? "";
  return itemId === "" && quantityPerUnit === "";
}

type ApiError = {
  error?: string;
  errors?: Record<string, string[]>;
};

type OrderSource = "stock" | "sales";
type BatchQuantityMode = "batches" | "output";

function formatSalesOrderLabel(
  value: string,
  salesOrderMap: Map<string, ManufacturingSalesOrderOption>
) {
  const order = salesOrderMap.get(value);
  if (!order) return "";
  return `${order.orderNumber} - ${order.customerName}`;
}

function formatSalesLineLabel(
  value: string,
  salesLineMap: Map<string, ManufacturingSalesLineOption>
) {
  const line = salesLineMap.get(value);
  if (!line) return "";

  return `${line.salesOrderNumber} - ${line.customerName} - ${line.quantity} ${line.unitName}`;
}

export function ManufacturingOrderForm({
  productTemplates = [],
  ingredientItemOptions = [],
  salesLineOptions = [],
  salesOrderOptions = [],
  initialData,
  initialSalesOrderId,
  initialSalesOrderPreview,
}: {
  productTemplates?: ManufacturingProductTemplate[];
  ingredientItemOptions?: Array<{
    id: string;
    name: string;
    displayName: string;
    itemType: string;
    unit: string;
  }>;
  salesLineOptions?: ManufacturingSalesLineOption[];
  salesOrderOptions?: ManufacturingSalesOrderOption[];
  initialData?: ManufacturingOrderEditData;
  initialSalesOrderId?: string | null;
  initialSalesOrderPreview?: ManufacturingSalesOrderPreview | null;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const timeZone = useOrganizationTimeZone();
  const isEditing = Boolean(initialData);
  const fallbackPath = initialData
    ? `/manufacturing/orders/${initialData.id}`
    : "/manufacturing/orders";
  const [formError, setFormError] = useState<string | null>(null);
  const [orderSource, setOrderSource] = useState<OrderSource>(
    initialSalesOrderId ? "sales" : "stock"
  );
  const [batchQuantityMode, setBatchQuantityMode] =
    useState<BatchQuantityMode>("batches");
  const todayDate = todayInTimeZone(timeZone);
  const formResolver = zodResolver(
    isEditing ? updateManufacturingOrderSchema : manufacturingOrderCreateFormSchema
  ) as Resolver<ManufacturingOrderFormValues>;

  const form = useForm<ManufacturingOrderFormValues>({
    resolver: formResolver,
    mode: "onBlur",
    defaultValues: initialData
      ? {
          productId: initialData.productId,
          salesOrderId: initialData.salesOrderId,
          salesOrderLineId: initialData.salesOrderLineId,
          plannedQuantity: initialData.requestedQuantity,
          priorityRank: initialData.priorityRank,
          plannedDate: initialData.plannedDate,
          notes: initialData.notes,
          ingredients: initialData.ingredients.map((ingredient) => ({
            itemId: ingredient.itemId,
            quantityPerUnit: ingredient.quantityPerUnit,
          })),
          groupRemainderChoices: initialData.ingredients
            .filter(
              (ingredient) =>
                ingredient.groupRemainderPolicy === "ask" &&
                ingredient.basisOutputQuantity != null &&
                ingredient.chosenGroupRemainderHandling != null
            )
            .map((ingredient) => ({
              basisOutputQuantity: ingredient.basisOutputQuantity!,
              handling:
                ingredient.chosenGroupRemainderHandling as GroupRemainderHandling,
            })),
          confirmShortage: false,
        }
      : {
          ...manufacturingOrderDefaultValues,
          salesOrderId: initialSalesOrderId ?? null,
          plannedDate: todayDate,
        },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "ingredients",
  });

  const watchedProductId = useWatch({
    control: form.control,
    name: "productId",
  });
  const watchedPlannedQuantity = useWatch({
    control: form.control,
    name: "plannedQuantity",
  });
  const watchedIngredients = useWatch({
    control: form.control,
    name: "ingredients",
  });
  const watchedSalesOrderId = useWatch({
    control: form.control,
    name: "salesOrderId",
  });
  const watchedGroupRemainderChoices = useWatch({
    control: form.control,
    name: "groupRemainderChoices",
  });

  const productOptions = useMemo(
    () =>
      productTemplates.map((product) => ({
        ...product,
        displayName: product.name,
        itemType: "product",
      })),
    [productTemplates]
  );
  const productMap = new Map(productTemplates.map((product) => [product.id, product]));
  const salesOrderIds = salesOrderOptions.map((order) => order.id);
  const salesOrderMap = new Map(salesOrderOptions.map((order) => [order.id, order]));
  const editSalesLineOptions =
    isEditing &&
    initialData?.salesOrderId &&
    initialData.salesOrderLineId &&
    !salesLineOptions.some(
      (option) => option.salesOrderLineId === initialData.salesOrderLineId
    )
      ? [
          {
            salesOrderId: initialData.salesOrderId,
            salesOrderLineId: initialData.salesOrderLineId,
            salesOrderNumber: initialData.salesOrderNumber ?? "Linked sales order",
            customerName: initialData.salesCustomerName ?? "Unknown customer",
            itemId: initialData.productId,
            itemName: initialData.productName,
            itemSku: initialData.productSku,
            quantity: initialData.requestedQuantity,
            unitName: initialData.unitName,
            status: "open" as const,
          },
          ...salesLineOptions,
        ]
      : salesLineOptions;
  const salesLineIds = editSalesLineOptions.map((line) => line.salesOrderLineId);
  const salesLineMap = new Map(
    editSalesLineOptions.map((line) => [line.salesOrderLineId, line])
  );
  const salesOrderLineIds = editSalesLineOptions
    .filter((line) => line.salesOrderId === watchedSalesOrderId)
    .map((line) => line.salesOrderLineId);
  const selectedProduct = productMap.get(watchedProductId ?? "");
  const ingredientOptions = useMemo(() => {
    const rows = isEditing ? initialData?.ingredients ?? [] : selectedProduct?.bom ?? [];
    const options = new Map<
      string,
      {
        id: string;
        name: string;
        displayName: string;
        sku: string | null;
        itemType: string;
        unitName: string | null;
      }
    >();

    ingredientItemOptions.forEach((item) => {
      if (item.id === watchedProductId) return;

      options.set(item.id, {
        id: item.id,
        name: item.name,
        displayName: item.displayName,
        sku: null,
        itemType: item.itemType,
        unitName: item.unit ?? "",
      });
    });

    rows.forEach((row) => {
      options.set(row.itemId, {
        id: row.itemId,
        name: row.itemName,
        displayName: row.itemName,
        sku: row.itemSku,
        itemType: row.itemType,
        unitName: row.unitName,
      });

      if ("alternates" in row) {
        row.alternates.forEach((alternate) => {
          options.set(alternate.itemId, {
            id: alternate.itemId,
            name: alternate.itemName,
            displayName: alternate.itemName,
            sku: alternate.itemSku,
            itemType: alternate.itemType,
            unitName: alternate.unitName,
          });
        });
      }
    });

    return Array.from(options.values()).sort((left, right) =>
      left.name.localeCompare(right.name)
    );
  }, [
    ingredientItemOptions,
    initialData?.ingredients,
    isEditing,
    selectedProduct?.bom,
    watchedProductId,
  ]);
  const ingredientOptionMap = new Map(
    ingredientOptions.map((option) => [option.id, option])
  );
  const selectedSalesOrder = salesOrderMap.get(watchedSalesOrderId ?? "");
  const watchedSalesOrderLineId = useWatch({
    control: form.control,
    name: "salesOrderLineId",
  });
  const isSalesOrderSource = !isEditing && orderSource === "sales";
  const isSalesOrderMode =
    isSalesOrderSource && watchedSalesOrderId != null && watchedSalesOrderLineId == null;

  useEffect(() => {
    if (!watchedProductId || isSalesOrderMode) return;
    const rows = watchedIngredients ?? [];
    const lastRow =
      rows[fields.length - 1] ??
      (fields[fields.length - 1] as ManufacturingOrderFormValues["ingredients"][number] | undefined);
    if (fields.length === 0 || !isBlankManufacturingIngredient(lastRow)) {
      append(
        {
          itemId: "",
          quantityPerUnit: "",
        },
        { shouldFocus: false }
      );
    }
  }, [append, fields, isSalesOrderMode, watchedIngredients, watchedProductId]);

  const selectedBomRows = isEditing
    ? initialData?.ingredients ?? []
    : selectedProduct?.bom ?? [];
  const firstBatchBasis = selectedBomRows.find(
    (row) => row.consumptionMode === "per_batch" && row.basisOutputQuantity != null
  )?.basisOutputQuantity;

  // For editing, use the snapshotted compatibility mode from the MO.
  const isBatchMode = isEditing
    ? initialData?.manufacturingMode === "batch"
    : selectedBomRows.some((row) => row.consumptionMode === "per_batch");
  const batchYield = isEditing
    ? initialData?.expectedBatchYield != null ? parseFloat(initialData.expectedBatchYield) : null
    : firstBatchBasis != null ? parseFloat(firstBatchBasis) : null;
  const isManualBatchCreate =
    !isEditing &&
    !isSalesOrderSource &&
    isBatchMode &&
    batchQuantityMode === "batches";

  // Manual batch creation enters batch count; existing/edit flows enter output quantity.
  const batchCalc = (() => {
    if (!isBatchMode || batchYield == null || batchYield <= 0) return null;
    const entered = parseFloat(watchedPlannedQuantity ?? "");
    if (!Number.isFinite(entered) || entered <= 0) return null;
    const numberOfBatches = isManualBatchCreate
      ? entered
      : Math.ceil(entered / batchYield);
    const plannedOutput = isManualBatchCreate ? numberOfBatches * batchYield : entered;
    return { numberOfBatches, plannedOutput };
  })();
  const effectiveOutputQuantity = batchCalc
    ? normalizeNumeric(batchCalc.plannedOutput)
    : watchedPlannedQuantity ?? "";
  const groupSummaries = summarizeGroupRemainders(
    selectedBomRows,
    effectiveOutputQuantity
  );
  const groupChoiceMap = new Map(
    (watchedGroupRemainderChoices ?? []).map((choice) => [
      makeGroupChoiceKey(choice.basisOutputQuantity),
      choice.handling,
    ])
  );
  const setGroupChoice = (
    basisOutputQuantity: string,
    handling: GroupRemainderHandling
  ) => {
    const key = makeGroupChoiceKey(basisOutputQuantity);
    const next = new Map(groupChoiceMap);
    next.set(key, handling);
    form.setValue(
      "groupRemainderChoices",
      [...next.entries()].map(
        ([basis, value]): GroupRemainderChoice => ({
          basisOutputQuantity: basis,
          handling: value,
        })
      ),
      { shouldDirty: true, shouldValidate: true }
    );
  };

  useEffect(() => {
    if (isSalesOrderMode) return;
    const requiredKeys = new Set(
      groupSummaries
        .filter((summary) => summary.requiresChoice)
        .map((summary) => summary.basisOutputQuantity)
    );
    const current = watchedGroupRemainderChoices ?? [];
    const next = [
      ...current.filter((choice) =>
        requiredKeys.has(makeGroupChoiceKey(choice.basisOutputQuantity))
      ),
    ];

    for (const key of requiredKeys) {
      if (!next.some((choice) => makeGroupChoiceKey(choice.basisOutputQuantity) === key)) {
        next.push({ basisOutputQuantity: key, handling: "leave_loose" });
      }
    }

    const currentSignature = current
      .map((choice) => `${makeGroupChoiceKey(choice.basisOutputQuantity)}:${choice.handling}`)
      .sort()
      .join("|");
    const nextSignature = next
      .map((choice) => `${makeGroupChoiceKey(choice.basisOutputQuantity)}:${choice.handling}`)
      .sort()
      .join("|");

    if (currentSignature !== nextSignature) {
      form.setValue("groupRemainderChoices", next, {
        shouldDirty: false,
        shouldValidate: true,
      });
    }
  }, [form, groupSummaries, isSalesOrderMode, watchedGroupRemainderChoices]);

  const previewQuery = useQuery<ManufacturingSalesOrderPreview>({
    queryKey: ["manufacturing-sales-order-preview", watchedSalesOrderId],
    queryFn: async () => {
      const response = await fetch(
        `/api/sales-orders/${watchedSalesOrderId}/manufacturing-orders`
      );
      const body = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to load sales order preview.");
      }

      return body as ManufacturingSalesOrderPreview;
    },
    enabled: isSalesOrderMode,
    initialData:
      watchedSalesOrderId != null && watchedSalesOrderId === initialSalesOrderId
        ? initialSalesOrderPreview ?? undefined
        : undefined,
  });

  const salesOrderPreview =
    isSalesOrderMode && watchedSalesOrderId != null
      ? previewQuery.data ?? null
      : null;

  const mutation = useMutation({
    mutationFn: async (values: ManufacturingOrderFormValues) => {
      if (!isEditing && values.salesOrderId && !values.salesOrderLineId) {
        const response = await fetch(
          `/api/sales-orders/${values.salesOrderId}/manufacturing-orders`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              plannedDate: values.plannedDate,
              salesOrderLineIds:
                salesOrderPreview?.lines
                  .filter((line) => line.status === "will_create")
                  .map((line) => line.salesOrderLineId) ?? [],
              priorityRank: null,
              notes: values.notes,
              confirmShortage: true,
            }),
          }
        );

        const body = await response.json().catch(() => null);

        if (!response.ok) {
          throw {
            error: body?.error ?? "Failed to create manufacturing orders.",
            errors: body?.errors,
          } satisfies ApiError;
        }

        return {
          kind: "sales-order" as const,
          salesOrderId: values.salesOrderId,
        };
      }

      const plannedQuantity = (() => {
        if (!isManualBatchCreate) return values.plannedQuantity ?? "";

        const batchCount = Number(values.plannedQuantity ?? "");
        if (
          !Number.isFinite(batchCount) ||
          batchCount <= 0 ||
          batchYield == null ||
          batchYield <= 0
        ) {
          throw {
            errors: {
              plannedQuantity: ["Enter a positive number of batches."],
            },
          } satisfies ApiError;
        }

        return normalizeNumeric(batchCount * batchYield);
      })();
      const manualBatchCount = isManualBatchCreate
        ? Number(values.plannedQuantity ?? "")
        : null;

      const payload = initialData
        ? {
            salesOrderId: values.salesOrderId,
            salesOrderLineId: values.salesOrderLineId,
            plannedQuantity,
            priorityRank: null,
            plannedDate: values.plannedDate,
            notes: values.notes,
            groupRemainderChoices: values.groupRemainderChoices,
            ingredients: values.ingredients,
          }
        : {
            productId: values.productId ?? "",
            salesOrderId: values.salesOrderId,
            salesOrderLineId: values.salesOrderLineId,
            plannedQuantity,
            batchCount:
              manualBatchCount != null ? normalizeNumeric(manualBatchCount) : undefined,
            priorityRank: null,
            plannedDate: values.plannedDate,
            notes: values.notes,
            groupRemainderChoices: values.groupRemainderChoices,
            ingredients: values.ingredients,
            confirmShortage: true,
          };

      const response = await fetch(
        initialData
          ? `/api/manufacturing-orders/${initialData.id}`
          : "/api/manufacturing-orders",
        {
          method: initialData ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );

      const body = await response.json().catch(() => null);

      if (!response.ok) {
        throw {
          error: body?.error ?? "Failed to save manufacturing order.",
          errors: body?.errors,
        } satisfies ApiError;
      }

      return {
        kind: "single" as const,
        id: body.id as string,
      };
    },
    onMutate: () => {
      setFormError(null);
      form.clearErrors();
    },
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["manufacturing-orders"] }),
        queryClient.invalidateQueries({ queryKey: ["items"] }),
        queryClient.invalidateQueries({ queryKey: ["sales-orders"] }),
      ]);

      if (result.kind === "sales-order") {
        router.push(`/sales/orders/${result.salesOrderId}`);
        return;
      }

      router.push(initialData ? fallbackPath : `/manufacturing/orders/${result.id}`);
    },
    onError: (error: ApiError) => {
      if (error.errors) {
        setFormError(error.error ?? "Fix the highlighted fields.");
        Object.entries(error.errors).forEach(([field, messages]) => {
          form.setError(field as never, {
            type: "server",
            message: messages[0],
          });
        });
        return;
      }

      setFormError(error.error ?? "Failed to save manufacturing order.");
    },
  });

  const handleCancel = useSmartBack(fallbackPath);
  const handleInvalidSubmit = (errors: typeof form.formState.errors) => {
    setFormError(
      getFirstFormErrorMessage(errors) ?? "Fix the highlighted fields."
    );
  };

  const handleSalesOrderChange = (salesOrderId: string) => {
    const selected = salesOrderMap.get(salesOrderId);

    if (!selected) {
      form.setValue("salesOrderId", null, {
        shouldValidate: true,
        shouldDirty: true,
      });
      form.setValue("salesOrderLineId", null);
      form.setValue("productId", "");
      form.setValue("plannedQuantity", "");
      form.setValue("groupRemainderChoices", []);
      form.setValue("ingredients", []);
      return;
    }

    form.setValue("salesOrderId", selected.id, {
      shouldValidate: true,
      shouldDirty: true,
    });
    form.setValue("salesOrderLineId", null);
    form.setValue("productId", "");
    form.setValue("plannedQuantity", "");
    form.setValue("ingredients", []);
    form.setValue("plannedDate", selected.shipDate ?? selected.requestedDate ?? todayDate, {
      shouldValidate: true,
      shouldDirty: true,
    });
  };

  const handleOrderSourceChange = (nextSource: OrderSource) => {
    if (nextSource === orderSource) return;
    setOrderSource(nextSource);
    form.setValue("salesOrderId", null, {
      shouldValidate: true,
      shouldDirty: true,
    });
    form.setValue("salesOrderLineId", null, {
      shouldValidate: true,
      shouldDirty: true,
    });
    form.setValue("productId", "");
    form.setValue("plannedQuantity", "");
    form.setValue("groupRemainderChoices", []);
    form.setValue("ingredients", []);
  };

  const handleProductChange = (productId: string) => {
    const template = productMap.get(productId);
    const hasBatchBom =
      template?.bom.some((row) => row.consumptionMode === "per_batch") ?? false;
    const nextBatchYield = template?.bom.find(
      (row) => row.consumptionMode === "per_batch" && row.basisOutputQuantity != null
    )?.basisOutputQuantity;

    form.setValue("productId", productId, { shouldValidate: true });
    form.setValue("salesOrderId", null);
    form.setValue("salesOrderLineId", null);
    setBatchQuantityMode(hasBatchBom ? "batches" : "output");
    form.setValue("plannedQuantity", hasBatchBom ? "1" : "");
    form.setValue("groupRemainderChoices", []);
    form.setValue(
      "ingredients",
      (template?.bom ?? []).map((ingredient) => ({
        itemId: ingredient.itemId,
        quantityPerUnit: ingredient.quantityPerUnit,
      })),
      { shouldValidate: true, shouldDirty: true }
    );

    if (hasBatchBom && nextBatchYield != null) {
      form.trigger("plannedQuantity");
    }
  };

  const handleBatchQuantityModeChange = (nextMode: BatchQuantityMode) => {
    if (nextMode === batchQuantityMode || batchYield == null || batchYield <= 0) {
      return;
    }

    const current = Number(watchedPlannedQuantity ?? "");
    const nextQuantity =
      Number.isFinite(current) && current > 0
        ? nextMode === "output"
          ? normalizeNumeric(current * batchYield)
          : normalizeNumeric(current / batchYield)
        : "";

    setBatchQuantityMode(nextMode);
    form.setValue("plannedQuantity", nextQuantity, {
      shouldValidate: true,
      shouldDirty: true,
    });
  };

  const handleSalesLineChange = (salesOrderLineId: string) => {
    const selected = salesLineMap.get(salesOrderLineId);

    if (!selected) {
      form.setValue("salesOrderLineId", null, {
        shouldValidate: true,
        shouldDirty: true,
      });
      return;
    }

    const template = productMap.get(selected.itemId);

    form.setValue("salesOrderId", selected.salesOrderId, {
      shouldValidate: true,
      shouldDirty: true,
    });
    form.setValue("salesOrderLineId", selected.salesOrderLineId, {
      shouldValidate: true,
      shouldDirty: true,
    });
    form.setValue("productId", selected.itemId, {
      shouldValidate: true,
      shouldDirty: true,
    });
    form.setValue("plannedQuantity", selected.quantity, {
      shouldValidate: true,
      shouldDirty: true,
    });
    form.setValue("groupRemainderChoices", [], {
      shouldValidate: true,
      shouldDirty: true,
    });
    form.setValue(
      "ingredients",
      (template?.bom ?? []).map((ingredient) => ({
        itemId: ingredient.itemId,
        quantityPerUnit: ingredient.quantityPerUnit,
      })),
      { shouldValidate: true, shouldDirty: true }
    );
  };

  const ingredientsError = getFieldArrayError(form.formState.errors.ingredients);
  const salesOrderModeDisabled =
    isSalesOrderSource &&
    (watchedSalesOrderId == null ||
      (isSalesOrderMode &&
        (!salesOrderPreview?.hasManufacturableLines || previewQuery.isLoading)));
  const createButtonLabel = isEditing
    ? mutation.isPending
      ? "Saving..."
      : "Save Changes"
    : isSalesOrderMode
      ? mutation.isPending
        ? "Creating..."
        : `Create ${salesOrderPreview?.manufacturableLineCount ?? 0} Order${
            (salesOrderPreview?.manufacturableLineCount ?? 0) === 1 ? "" : "s"
          }`
      : mutation.isPending
        ? "Creating..."
        : "Create Order";
  const runOutputQuantity = batchCalc
    ? formatQuantity(String(batchCalc.plannedOutput))
    : formatQuantity(watchedPlannedQuantity);
  const runIngredientCount = isSalesOrderMode
    ? salesOrderPreview?.manufacturableLineCount ?? 0
    : fields.length;

  return (
    <CreatePageShell>
      <CreatePageHeader
        eyebrow="Manufacturing · Orders"
        title={isEditing ? "Edit Manufacturing Order" : "Add Manufacturing Order"}
        actions={
          <>
          <Button type="button" variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="manufacturing-order-form"
            disabled={mutation.isPending || salesOrderModeDisabled}
          >
            {createButtonLabel}
          </Button>
          </>
        }
      />

      {formError && <FieldError>{formError}</FieldError>}

      <CreatePageGrid
        sidebar={
          <CreateSidebarCard
            title="Run summary"
            footer={
              <div className="w-full rounded-md bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
                {watchedProductId || isSalesOrderMode
                  ? "Review ingredients before creating the order."
                  : "Pick a product to check the run."}
              </div>
            }
          >
            <SummaryRows
              rows={[
                {
                  label: "Output",
                  value: runOutputQuantity,
                },
                {
                  label: isSalesOrderMode ? "Orders" : "Ingredients",
                  value: runIngredientCount,
                },
                {
                  label: "Mode",
                  value: isBatchMode ? "Batch" : "Discrete",
                },
              ]}
            />
          </CreateSidebarCard>
        }
      >
      <form
        id="manufacturing-order-form"
        onSubmit={form.handleSubmit(
          (values) => mutation.mutate(values),
          handleInvalidSubmit
        )}
      >
        <FieldGroup className="gap-6">
          <CreateSection
            title="Order basics"
          >
            <FieldGroup>
              {!isEditing && (
                <Field>
                  <FieldLabel>Order source</FieldLabel>
                  <ToggleGroup
                    type="single"
                    variant="segmented"
                    size="sm"
                    value={orderSource}
                    onValueChange={(value) => {
                      if (value === "stock" || value === "sales") {
                        handleOrderSourceChange(value);
                      }
                    }}
                    aria-label="Choose manufacturing order source"
                    className="max-w-full flex-wrap bg-muted p-(--space-1)"
                  >
                    <ToggleGroupItem value="stock">Make to stock</ToggleGroupItem>
                    <ToggleGroupItem value="sales">Sales order</ToggleGroupItem>
                  </ToggleGroup>
                </Field>
              )}

              {isSalesOrderSource && (
                <Controller
                  control={form.control}
                  name="salesOrderId"
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel>
                        <TooltipHeader
                          label="Sales Order"
                          tooltip={MANUFACTURING_SALES_ORDER_TOOLTIP}
                        />
                      </FieldLabel>
                      <Combobox
                        items={salesOrderIds}
                        value={field.value ?? ""}
                        onValueChange={(value) => handleSalesOrderChange(value ?? "")}
                        itemToStringLabel={(value) =>
                          formatSalesOrderLabel(value, salesOrderMap)
                        }
                      >
                        <ComboboxInput
                          placeholder="Search open sales orders..."
                          showClear
                        />
                        <ComboboxContent className="bg-popover text-popover-foreground">
                          <ComboboxEmpty>No open sales orders found</ComboboxEmpty>
                          <ComboboxList>
                            {(id: string) => {
                              const order = salesOrderMap.get(id);
                              return (
                                <ComboboxItem
                                  key={id}
                                  value={id}
                                  disabled={!order?.hasManufacturableLines}
                                >
                                  <div className="flex min-w-0 flex-1 items-center gap-2">
                                    <span className="truncate">
                                      {order?.orderNumber} - {order?.customerName}
                                    </span>
                                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                                      {order?.manufacturableLineCount ?? 0} manufacturable
                                    </span>
                                  </div>
                                </ComboboxItem>
                              );
                            }}
                          </ComboboxList>
                        </ComboboxContent>
                      </Combobox>
                      {selectedSalesOrder?.disabledReason && (
                        <p className="text-xs text-muted-foreground">
                          {selectedSalesOrder.disabledReason}
                        </p>
                      )}
                      {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                    </Field>
                  )}
                />
              )}

              {isSalesOrderMode && (
                <Controller
                  control={form.control}
                  name="salesOrderLineId"
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor={field.name}>
                        <TooltipHeader
                          label="Sales Order Line"
                          tooltip={MANUFACTURING_SALES_ORDER_TOOLTIP}
                        />
                      </FieldLabel>
                      <Combobox
                        items={salesOrderLineIds}
                        value={field.value ?? ""}
                        onValueChange={(value) => handleSalesLineChange(value ?? "")}
                        itemToStringLabel={(value) =>
                          formatSalesLineLabel(value, salesLineMap)
                        }
                      >
                        <ComboboxInput
                          id={field.name}
                          placeholder="Search sales lines..."
                          showClear
                        />
                        <ComboboxContent className="bg-popover text-popover-foreground">
                          <ComboboxEmpty>No matching sales lines found</ComboboxEmpty>
                          <ComboboxList>
                            {(id: string) => {
                              const line = salesLineMap.get(id);
                              return (
                                <ComboboxItem key={id} value={id}>
                                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                                    <span className="truncate">{line?.itemName}</span>
                                    <span className="text-xs text-muted-foreground">
                                      {line
                                        ? `${line.quantity} ${line.unitName}${
                                            line.itemSku ? ` • ${line.itemSku}` : ""
                                          }`
                                        : ""}
                                    </span>
                                  </div>
                                </ComboboxItem>
                              );
                            }}
                          </ComboboxList>
                        </ComboboxContent>
                      </Combobox>
                      {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                    </Field>
                  )}
                />
              )}

              {!isSalesOrderMode &&
                (!isSalesOrderSource || watchedSalesOrderLineId != null) &&
                (isEditing ? (
                  <>
                    <Field>
                      <FieldLabel htmlFor="productName">Product</FieldLabel>
                      <Input
                        id="productName"
                        value={
                          initialData?.productSku
                            ? `${initialData.productName} (${initialData.productSku})`
                            : initialData?.productName ?? ""
                        }
                        disabled
                      />
                    </Field>

                    <Controller
                      control={form.control}
                      name="salesOrderLineId"
                      render={({ field, fieldState }) => (
                        <Field data-invalid={fieldState.invalid}>
                          <FieldLabel htmlFor={field.name}>
                            <TooltipHeader
                              label="Sales Order Line"
                              tooltip={MANUFACTURING_SALES_ORDER_TOOLTIP}
                            />
                          </FieldLabel>
                          <Combobox
                            items={salesLineIds}
                            value={field.value ?? ""}
                            onValueChange={(value) =>
                              handleSalesLineChange(value ?? "")
                            }
                            itemToStringLabel={(value) =>
                              formatSalesLineLabel(value, salesLineMap)
                            }
                          >
                            <ComboboxInput
                              id={field.name}
                              placeholder="Search active sales lines..."
                              showClear
                            />
                            <ComboboxContent className="bg-popover text-popover-foreground">
                              <ComboboxEmpty>No matching sales lines found</ComboboxEmpty>
                              <ComboboxList>
                                {(id: string) => {
                                  const line = salesLineMap.get(id);
                                  return (
                                    <ComboboxItem key={id} value={id}>
                                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                                        <span className="truncate">
                                          {line?.salesOrderNumber} - {line?.customerName}
                                        </span>
                                        <span className="text-xs text-muted-foreground">
                                          {line
                                            ? `${line.quantity} ${line.unitName} • ${line.status}`
                                            : ""}
                                        </span>
                                      </div>
                                    </ComboboxItem>
                                  );
                                }}
                              </ComboboxList>
                            </ComboboxContent>
                          </Combobox>
                          {fieldState.invalid && (
                            <FieldError errors={[fieldState.error]} />
                          )}
                        </Field>
                      )}
                    />
                  </>
                ) : (
                  <>
                    <Controller
                      control={form.control}
                      name="productId"
                      render={({ field, fieldState }) => (
                        <Field data-invalid={fieldState.invalid}>
                          <FieldLabel>Product</FieldLabel>
                          <InventoryItemCombobox
                            options={productOptions}
                            value={field.value ?? ""}
                            onValueChange={(value) => handleProductChange(value ?? "")}
                            placeholder="Search products..."
                            emptyMessage="No products found"
                            createLinks={[
                              {
                                href: "/inventory/products/new",
                                label: "Create product",
                              },
                            ]}
                            getSecondaryText={(product) =>
                              [product.sku, product.unitName]
                                .filter((part): part is string => part != null && part !== "")
                                .join(" · ")
                            }
                          />
                          <FieldDescription>
                            {watchedProductId
                              ? "Change the product to reset ingredients."
                              : "Only products with an active BOM can be manufactured."}
                          </FieldDescription>
                          {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                        </Field>
                      )}
                    />

                    {isSalesOrderSource && (
                      <Controller
                        control={form.control}
                        name="salesOrderLineId"
                        render={({ field, fieldState }) => (
                          <Field data-invalid={fieldState.invalid}>
                            <FieldLabel htmlFor={field.name}>
                              <TooltipHeader
                                label="Sales Order Line"
                                tooltip={MANUFACTURING_SALES_ORDER_TOOLTIP}
                              />
                            </FieldLabel>
                            <Combobox
                              items={salesLineIds}
                              value={field.value ?? ""}
                              onValueChange={(value) =>
                                handleSalesLineChange(value ?? "")
                              }
                              itemToStringLabel={(value) =>
                                formatSalesLineLabel(value, salesLineMap)
                              }
                            >
                              <ComboboxInput
                                id={field.name}
                                placeholder="Search active sales lines..."
                                showClear
                              />
                              <ComboboxContent className="bg-popover text-popover-foreground">
                                <ComboboxEmpty>No matching sales lines found</ComboboxEmpty>
                                <ComboboxList>
                                  {(id: string) => {
                                    const line = salesLineMap.get(id);
                                    return (
                                      <ComboboxItem key={id} value={id}>
                                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                                          <span className="truncate">
                                            {line?.salesOrderNumber} - {line?.customerName}
                                          </span>
                                          <span className="text-xs text-muted-foreground">
                                            {line
                                              ? `${line.quantity} ${line.unitName} • ${line.itemName}`
                                              : ""}
                                          </span>
                                        </div>
                                      </ComboboxItem>
                                    );
                                  }}
                                </ComboboxList>
                              </ComboboxContent>
                            </Combobox>
                            {fieldState.invalid && (
                              <FieldError errors={[fieldState.error]} />
                            )}
                          </Field>
                        )}
                      />
                    )}
                  </>
                ))}

              <div className="grid gap-4 md:grid-cols-2">
                {!isSalesOrderMode &&
                  (!isSalesOrderSource || watchedSalesOrderLineId != null) && (
                  <Controller
                    control={form.control}
                    name="plannedQuantity"
                    render={({ field, fieldState }) => (
                      <Field data-invalid={fieldState.invalid}>
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <FieldLabel htmlFor={field.name}>
                            {isManualBatchCreate ? (
                              "Batches"
                            ) : (
                              <TooltipHeader
                                label="Planned Quantity"
                                tooltip={MANUFACTURING_PLANNED_QTY_TOOLTIP}
                              />
                            )}
                          </FieldLabel>
                          {!isEditing && !isSalesOrderSource && isBatchMode && (
                            <ToggleGroup
                              type="single"
                              variant="segmented"
                              size="sm"
                              value={batchQuantityMode}
                              onValueChange={(value) => {
                                if (value === "batches" || value === "output") {
                                  handleBatchQuantityModeChange(value);
                                }
                              }}
                              aria-label="Choose quantity entry mode"
                              className="bg-muted p-(--space-1)"
                            >
                              <ToggleGroupItem value="batches">Batches</ToggleGroupItem>
                              <ToggleGroupItem value="output">Output</ToggleGroupItem>
                            </ToggleGroup>
                          )}
                        </div>
                        <Input
                          {...field}
                          id={field.name}
                          value={field.value ?? ""}
                          aria-invalid={fieldState.invalid}
                          inputMode="decimal"
                          autoComplete="off"
                          placeholder="0"
                        />
                        {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                      </Field>
                    )}
                  />
                )}

                {!isSalesOrderMode &&
                  (!isSalesOrderSource || watchedSalesOrderLineId != null) &&
                  isBatchMode &&
                  batchCalc && (
                  <div className="col-span-full border border-dashed px-4 py-3">
                    <p className="text-sm text-muted-foreground">
                      <span className="font-medium text-foreground">{batchCalc.numberOfBatches} batch{batchCalc.numberOfBatches === 1 ? "" : "es"}</span>
                      {" of up to "}
                      {formatQuantity(String(batchYield))} {selectedProduct?.unitName ?? initialData?.unitName ?? "units"}
                      {isManualBatchCreate ? (
                        <>
                          {"; "}
                          {formatQuantity(String(batchCalc.plannedOutput))} planned output
                        </>
                      ) : null}
                    </p>
                  </div>
                )}

                {!isSalesOrderMode &&
                  (!isSalesOrderSource || watchedSalesOrderLineId != null) &&
                  groupSummaries.length > 0 && (
                  <div className="col-span-full space-y-3 rounded-lg border border-dashed px-4 py-3">
                    <p className="text-sm font-medium">Grouped materials</p>
                    {groupSummaries.map((summary) => {
                      const fixedPolicies = [...summary.policies];
                      const hasMixedFixedPolicies =
                        !summary.requiresChoice && fixedPolicies.length > 1;
                      const currentChoice = summary.requiresChoice
                        ? groupChoiceMap.get(summary.basisOutputQuantity) ??
                          "leave_loose"
                        : fixedPolicies.includes("create_partial_group")
                          ? "create_partial_group"
                          : "leave_loose";
                      const hasRemainder =
                        parseFloat(summary.remainderQuantity) > 0;
                      const groupCount =
                        !hasRemainder || currentChoice === "leave_loose"
                          ? summary.fullGroupCount
                          : summary.fullGroupCount + 1;

                      return (
                        <div
                          key={summary.basisOutputQuantity}
                          className="grid gap-3 md:grid-cols-[1fr_auto]"
                        >
                          <div className="text-sm text-muted-foreground">
                            <span className="font-medium text-foreground">
                              {groupCount} group{groupCount === 1 ? "" : "s"}
                            </span>
                            {" of "}
                            {formatQuantity(summary.basisOutputQuantity)}{" "}
                            {selectedProduct?.unitName ?? initialData?.unitName ?? "units"}
                            {hasRemainder ? (
                              <>
                                {"; "}
                                {formatQuantity(summary.remainderQuantity)} leftover
                              </>
                            ) : null}
                            {hasMixedFixedPolicies ? (
                              <>
                                {"; mixed leftover policies"}
                              </>
                            ) : null}
                          </div>
                          {summary.requiresChoice ? (
                            <Select
                              value={currentChoice}
                              onValueChange={(value) =>
                                setGroupChoice(
                                  summary.basisOutputQuantity,
                                  value as GroupRemainderHandling
                                )
                              }
                            >
                              <SelectTrigger className="w-56">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="leave_loose">
                                  Leave loose
                                </SelectItem>
                                <SelectItem value="create_partial_group">
                                  Create partial group
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}

                <Controller
                  control={form.control}
                  name="plannedDate"
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor={field.name}>
                        {isSalesOrderMode ? "Batch Planned Date" : "Planned Date"}
                      </FieldLabel>
                      <DatePicker
                        id={field.name}
                        value={field.value ?? ""}
                        onChange={(value) => field.onChange(value || null)}
                        onBlur={field.onBlur}
                        aria-invalid={fieldState.invalid}
                      />
                      {isSalesOrderMode && (
                        <FieldDescription>
                          Shared by every created order.
                        </FieldDescription>
                      )}
                      {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                    </Field>
                  )}
                />
              </div>
            </FieldGroup>
          </CreateSection>

          {isSalesOrderMode ? (
            <CreateSection
              title="Sales order preview"
            >
              <FieldGroup>
                {previewQuery.isLoading ? (
                  <div className="border border-dashed px-4 py-6">
                    <p className="text-sm text-muted-foreground">
                      Loading sales order preview...
                    </p>
                  </div>
                ) : salesOrderPreview ? (
                  <>
                    <div className="grid gap-4 md:grid-cols-3">
                      <div className="border px-4 py-3">
                        <p className="text-xs uppercase text-muted-foreground">
                          Sales Order
                        </p>
                        <p className="mt-1 text-sm font-medium">
                          {salesOrderPreview.salesOrderNumber}
                        </p>
                      </div>
                      <div className="border px-4 py-3">
                        <p className="text-xs uppercase text-muted-foreground">
                          Customer
                        </p>
                        <p className="mt-1 text-sm font-medium">
                          {salesOrderPreview.customerName}
                        </p>
                      </div>
                      <div className="border px-4 py-3">
                        <p className="text-xs uppercase text-muted-foreground">
                          Will Create
                        </p>
                        <p className="mt-1 text-sm font-medium">
                          {salesOrderPreview.manufacturableLineCount} order
                          {salesOrderPreview.manufacturableLineCount === 1 ? "" : "s"}
                        </p>
                      </div>
                    </div>

                    <div className="overflow-x-auto border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Product</TableHead>
                            <TableHead className="w-32 text-right">
                              <TooltipHeader label="Qty" tooltip={SALES_LINE_QTY_TOOLTIP} />
                            </TableHead>
                            <TableHead className="w-28">
                              <TooltipHeader label="Unit" tooltip={UNIT_TOOLTIP} />
                            </TableHead>
                            <TableHead className="w-40">Status</TableHead>
                            <TableHead>Reason</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {salesOrderPreview.lines.map((line) => (
                            <TableRow key={line.salesOrderLineId}>
                              <TableCell>
                                <div className="space-y-1">
                                  <div className="font-medium">{line.itemName}</div>
                                  {line.itemSku && (
                                    <p className="text-xs text-muted-foreground">
                                      {line.itemSku}
                                    </p>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="text-right">
                                {line.quantity}
                              </TableCell>
                              <TableCell>{line.unitName}</TableCell>
                              <TableCell>
                                <Badge
                                  variant={
                                    line.status === "will_create"
                                      ? "secondary"
                                      : "outline"
                                  }
                                >
                                  {line.status === "will_create"
                                    ? "Will create"
                                    : "Skipped"}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-sm text-muted-foreground">
                                {line.skipMessage ?? "\u2014"}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>

                    {!salesOrderPreview.hasManufacturableLines && (
                      <FieldError>
                        {salesOrderPreview.disabledReason ??
                          "No manufacturable lines remain on this order."}
                      </FieldError>
                    )}
                  </>
                ) : (
                  <div className="border border-dashed px-4 py-6">
                    <p className="text-sm text-muted-foreground">
                      Select an open sales order.
                    </p>
                  </div>
                )}
              </FieldGroup>
            </CreateSection>
          ) : !isSalesOrderSource || watchedSalesOrderLineId != null ? (
            <CreateSection
              title="Ingredients"
              action={
                <Badge variant={fields.length > 0 ? "secondary" : "outline"}>
                  {fields.length > 0 ? "BOM loaded" : "No product"}
                </Badge>
              }
            >
              <FieldGroup>
                {fields.length > 0 ? (
                  <EditableLineGrid
                    columns={MANUFACTURING_INGREDIENT_GRID_COLUMNS}
                    minWidth="38rem"
                    headers={[
                      "Ingredient",
                      <TooltipHeader
                        key="quantity"
                        label="Qty used"
                        tooltip={BOM_QTY_PER_UNIT_TOOLTIP}
                      />,
                      <TooltipHeader
                        key="planned-total"
                        label="Planned Total"
                        tooltip={MANUFACTURING_PLANNED_TOTAL_TOOLTIP}
                      />,
                      <TooltipHeader key="unit" label="Unit" tooltip={UNIT_TOOLTIP} />,
                      <span key="actions" />,
                    ]}
                  >
                    {fields.map((field, index) => {
                      const selectedIngredientId =
                        watchedIngredients?.[index]?.itemId ?? field.itemId;
                      const selectedMaterial = ingredientOptionMap.get(selectedIngredientId);
                      const quantityPerUnit =
                        watchedIngredients?.[index]?.quantityPerUnit ?? "";
                      const bomRow = selectedBomRows[index];
                      const plannedTotal = (() => {
                        if (!bomRow) return "\u2014";
                        const calculation = calculateConsumptionRequirement({
                          outputQuantity: effectiveOutputQuantity,
                          quantity: quantityPerUnit,
                          consumptionMode: bomRow.consumptionMode as ConsumptionMode,
                          basisOutputQuantity: bomRow.basisOutputQuantity,
                          batchScalingMode: bomRow.batchScalingMode as BatchScalingMode | null,
                          groupRemainderPolicy:
                            bomRow.groupRemainderPolicy as GroupRemainderPolicy | null,
                          chosenGroupRemainderHandling:
                            bomRow.basisOutputQuantity != null
                              ? groupChoiceMap.get(
                                  makeGroupChoiceKey(bomRow.basisOutputQuantity)
                                )
                              : undefined,
                        });

                        return calculation.plannedQuantity ?? "\u2014";
                      })();

                      return (
                        <EditableLineGridRow
                          key={field.id}
                          aria-label={[
                            selectedMaterial?.name,
                            quantityPerUnit,
                            plannedTotal,
                            selectedMaterial?.unitName,
                          ]
                            .filter((part): part is string => Boolean(part))
                            .join(" ")}
                        >
                          <EditableLineGridCell>
                            <Controller
                              control={form.control}
                              name={`ingredients.${index}.itemId`}
                              render={({ field: ingredientField, fieldState }) => (
                                <Field data-invalid={fieldState.invalid}>
                                  <FieldLabel
                                    className="sr-only"
                                    htmlFor={`ingredient-${index}-item`}
                                  >
                                    Ingredient
                                  </FieldLabel>
                                  <InventoryItemCombobox
                                    options={ingredientOptions}
                                    value={ingredientField.value ?? ""}
                                    onValueChange={(value) =>
                                      ingredientField.onChange(value ?? "")
                                    }
                                    inputId={`ingredient-${index}-item`}
                                    inputAriaInvalid={fieldState.invalid}
                                    inputClassName="w-full min-w-0"
                                    placeholder="Search ingredients..."
                                    emptyMessage="No ingredients found"
                                    contentClassName="w-[min(32rem,calc(100vw-2rem))]"
                                    showTypeBadge
                                    getSecondaryText={(option) =>
                                      [option.sku, option.unitName]
                                        .filter((part): part is string => Boolean(part))
                                        .join(" · ")
                                    }
                                  />
                                  {selectedMaterial ? (
                                    <p className="mt-1 truncate text-xs text-muted-foreground">
                                      {selectedMaterial.name}
                                      {selectedMaterial.sku ? ` · ${selectedMaterial.sku}` : ""}
                                    </p>
                                  ) : null}
                                  {fieldState.invalid && (
                                    <FieldError errors={[fieldState.error]} />
                                  )}
                                </Field>
                              )}
                            />
                          </EditableLineGridCell>
                          <EditableLineGridCell>
                            <Controller
                              control={form.control}
                              name={`ingredients.${index}.quantityPerUnit`}
                              render={({ field: quantityField, fieldState }) => (
                                <Field data-invalid={fieldState.invalid}>
                                  <FieldLabel
                                    className="sr-only"
                                    htmlFor={`ingredient-${index}-quantity-per-unit`}
                                  >
                                    Qty used
                                  </FieldLabel>
                                  <Input
                                    {...quantityField}
                                    id={`ingredient-${index}-quantity-per-unit`}
                                    aria-invalid={fieldState.invalid}
                                    inputMode="decimal"
                                    autoComplete="off"
                                    className="w-full min-w-0"
                                  />
                                  {fieldState.invalid && (
                                    <FieldError errors={[fieldState.error]} />
                                  )}
                                </Field>
                              )}
                            />
                          </EditableLineGridCell>
                          <EditableLineGridCell className="font-mono text-sm tabular-nums">
                            {plannedTotal}
                          </EditableLineGridCell>
                          <EditableLineGridCell className="truncate text-sm text-muted-foreground">
                            {selectedMaterial?.unitName ?? "\u2014"}
                          </EditableLineGridCell>
                          <EditableLineGridCell>
                            <EditableLineGridRemoveButton
                              onClick={() => remove(index)}
                              label={`Remove ingredient ${index + 1}`}
                            />
                          </EditableLineGridCell>
                        </EditableLineGridRow>
                      );
                    })}
                  </EditableLineGrid>
                ) : (
                  <div className="border border-dashed px-4 py-6">
                    <p className="text-sm text-muted-foreground">
                      {watchedProductId
                        ? "No eligible BOM ingredients."
                        : "Select a product."}
                    </p>
                  </div>
                )}

                {ingredientsError && <FieldError>{ingredientsError}</FieldError>}
              </FieldGroup>
            </CreateSection>
          ) : null}

          <CreateSection
            title="Notes"
          >
            <FieldGroup>
              <Controller
                control={form.control}
                name="notes"
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor={field.name}>Notes</FieldLabel>
                    <Textarea
                      {...field}
                      id={field.name}
                      value={field.value ?? ""}
                      onChange={(event) => field.onChange(event.target.value || null)}
                      aria-invalid={fieldState.invalid}
                      rows={6}
                    />
                    {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                  </Field>
                )}
              />
            </FieldGroup>
          </CreateSection>
        </FieldGroup>
      </form>
      </CreatePageGrid>
    </CreatePageShell>
  );
}
