"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useSmartBack } from "@/lib/hooks/use-smart-back";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import { CircleLock01Icon, CircleUnlock01Icon } from "@hugeicons/core-free-icons";
import {
  insertItemSchema,
  updateItemSchema,
  type InsertItemFormValues,
  type UpdateItemFormValues,
} from "@/lib/schemas/items";
import { ITEM_TYPE_SEGMENTS } from "@/app/(dashboard)/inventory/types";
import type { getItem } from "@/app/(dashboard)/inventory/queries";
import { getUomOptions } from "@/lib/units-of-measure";
import { derivePurchaseToStockFactor } from "@/lib/units-of-measure";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  FieldLegend,
  FieldSeparator,
  FieldSet,
} from "@/components/ui/field";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { BomEditor } from "@/app/(dashboard)/inventory/bom-editor";

const CREATE_NEW_UNIT = "__create_new__";
const POSITIVE_NUMBER_RE = /^\d+\.?\d*$/;
const uomGroups = getUomOptions();

type AvailableComponent = {
  id: string;
  name: string;
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
    bom?: { componentId: string; quantity: string | null }[];
  };
}

type ItemFormValues = InsertItemFormValues | UpdateItemFormValues;

export function ItemForm({
  itemType,
  units,
  categories,
  availableComponents,
  canManageBomLock = false,
  initialData,
}: ItemFormProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const segment = ITEM_TYPE_SEGMENTS[itemType];
  const isEditing = Boolean(initialData);
  const typeLabel = itemType === "product" ? "Product" : "Material";
  const fallbackPath = `/inventory/${segment}${initialData ? `/${initialData.id}` : ""}`;
  const [categoryInput, setCategoryInput] = useState("");
  const [localUnits, setLocalUnits] = useState(units);
  const [isUnitDialogOpen, setIsUnitDialogOpen] = useState(false);
  const [bomLockConfirmOpen, setBomLockConfirmOpen] = useState(false);
  const [pendingBomLocked, setPendingBomLocked] = useState<boolean | null>(null);
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

  const form = useForm<ItemFormValues>({
    resolver: zodResolver(initialData ? updateItemSchema : insertItemSchema),
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
          defaultSellingPrice: initialData.defaultSellingPrice,
          manufacturingMode: initialData.manufacturingMode as "discrete" | "batch" ?? "discrete",
          expectedBatchYield: initialData.expectedBatchYield,
          bomLocked: initialData.bomLocked ?? false,
          stock: initialData.stock,
          safetyStock: initialData.safetyStock,
          bom: initialData.bom ?? [],
          revisionNote: null,
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
          defaultSellingPrice: null,
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
    if (!selectedPurchaseUnitId) {
      form.setValue("purchaseToStockFactor", null, {
        shouldDirty: true,
        shouldValidate: true,
      });
      return;
    }

    if (derivedPurchaseFactor == null) {
      form.setValue("purchaseToStockFactor", null, {
        shouldDirty: true,
        shouldValidate: true,
      });
      return;
    }

    form.setValue("purchaseToStockFactor", derivedPurchaseFactor.toFixed(4).replace(/\.?0+$/, ""), {
      shouldDirty: true,
      shouldValidate: true,
    });
  }, [derivedPurchaseFactor, form, selectedPurchaseUnitId]);

  const mutation = useMutation({
    mutationFn: async (data: ItemFormValues) => {
      const url = initialData ? `/api/items/${initialData.id}` : "/api/items";
      const method = initialData ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const fallback = initialData
          ? `Failed to update ${typeLabel.toLowerCase()}.`
          : `Failed to create ${typeLabel.toLowerCase()}.`;
        const err = await res.json().catch(() => null);
        if (err?.errors) {
          const messages = Object.entries(err.errors)
            .map(([field, msgs]) => `${field}: ${(msgs as string[]).join(", ")}`)
            .join("; ");
          throw new Error(messages);
        }
        throw new Error(err?.error ?? fallback);
      }
      return res.json();
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["items", itemType] });
      router.push(isEditing ? fallbackPath : `/inventory/${segment}/${result.id}`);
    },
    onError: (error) => {
      setFormError(error.message);
    },
    onMutate: () => {
      setFormError(null);
    },
  });

  const unitMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/units", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: unitName, size: unitSize, uom: unitUom }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? "Failed to create unit.");
      }
      return res.json();
    },
    onSuccess: (newUnit) => {
      setLocalUnits((prev) => [...prev, newUnit]);
      form.setValue("unitDefinitionId", newUnit.id);
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
    : (mutation.isPending ? "Creating..." : `Create ${typeLabel}`);
  const isBomDirty = itemType === "product" && Boolean(form.formState.dirtyFields.bom);
  const lockTarget = pendingBomLocked ?? bomLocked;
  const lockDialogTitle = lockTarget ? "Lock this BOM?" : "Unlock this BOM?";
  const lockDialogDescription = lockTarget
    ? "Only inventory admins will be able to view and edit this BOM once it is locked."
    : "Members with inventory view or operate access will be able to view and edit this BOM once it is unlocked.";

  const handleCancel = useSmartBack(fallbackPath);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="space-y-1.5">
          <h1 className="text-3xl font-semibold tracking-tight">
            {isEditing ? `Edit ${typeLabel}` : `Add ${typeLabel}`}
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            {isEditing
              ? `Update this ${typeLabel.toLowerCase()}'s details.`
              : `Create a new ${typeLabel.toLowerCase()} in your inventory.`}
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
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
        </div>
      </div>

      <Separator />

      {formError && <FieldError>{formError}</FieldError>}

      <form
        id="item-form"
        className="space-y-0"
        onSubmit={form.handleSubmit((data) => { if (!mutation.isPending) mutation.mutate(data); })}
      >
        <FieldGroup className="gap-8">
          <FieldSet className="max-w-4xl gap-5">
            <FieldLegend>Basics</FieldLegend>
            <FieldDescription>
              Name, category, and unit details for this {typeLabel.toLowerCase()}.
            </FieldDescription>
            <FieldGroup>
              <Controller
                name="name"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor={field.name}>Name</FieldLabel>
                    <Input
                      {...field}
                      id={field.name}
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
                <Controller
                  name="sku"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor={field.name}>SKU</FieldLabel>
                      <Input
                        {...field}
                        id={field.name}
                        value={field.value ?? ""}
                        aria-invalid={fieldState.invalid}
                        placeholder="MAT-001"
                        autoComplete="off"
                      />
                      {fieldState.invalid && (
                        <FieldError errors={[fieldState.error]} />
                      )}
                    </Field>
                  )}
                />

                <Controller
                  name="category"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor={field.name}>Category</FieldLabel>
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

              {initialData ? (
                <Field>
                  <FieldLabel>Stocking Unit</FieldLabel>
                  <p className="py-2 text-sm">
                    {initialData.unitName} ({initialData.unitSize} {initialData.unitUom})
                  </p>
                </Field>
              ) : (
                <Controller
                  name="unitDefinitionId"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor={field.name}>Stocking Unit</FieldLabel>
                      <Select
                        key={field.value}
                        name={field.name}
                        value={field.value}
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
              )}

              <Controller
                name="purchaseUnitDefinitionId"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor={field.name}>Purchase Unit</FieldLabel>
                    <Select
                      name={field.name}
                      value={field.value ?? "__none__"}
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
                    {!fieldState.invalid && (
                      <FieldDescription>
                        Leave blank to purchase this {typeLabel.toLowerCase()} in stocking units.
                      </FieldDescription>
                    )}
                    {fieldState.invalid && (
                      <FieldError errors={[fieldState.error]} />
                    )}
                  </Field>
                )}
              />

              {purchaseUnit && stockingUnit && derivedPurchaseFactor != null ? (
                <Field>
                  <FieldLabel>Purchase Conversion</FieldLabel>
                  <p className="py-2 text-sm text-muted-foreground">
                    1 {purchaseUnit.name} = {derivedPurchaseFactor} {stockingUnit.name}
                  </p>
                </Field>
              ) : null}

              {purchaseUnit && stockingUnit && derivedPurchaseFactor == null ? (
                <Controller
                  name="purchaseToStockFactor"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor={field.name}>
                        Stocking Units per 1 Purchase Unit
                      </FieldLabel>
                      <Input
                        {...field}
                        id={field.name}
                        value={field.value ?? ""}
                        onChange={(event) => field.onChange(event.target.value || null)}
                        aria-invalid={fieldState.invalid}
                        placeholder={`How many ${stockingUnit.name} per 1 ${purchaseUnit.name}?`}
                        inputMode="decimal"
                        autoComplete="off"
                      />
                      {!fieldState.invalid && (
                        <FieldDescription>
                          Enter the stocking-unit equivalent for one purchase unit.
                        </FieldDescription>
                      )}
                      {fieldState.invalid && (
                        <FieldError errors={[fieldState.error]} />
                      )}
                    </Field>
                  )}
                />
              ) : null}
            </FieldGroup>
          </FieldSet>

          <FieldSeparator />

          <FieldSet className="max-w-4xl gap-5">
            <FieldLegend>Pricing & Stock</FieldLegend>
            <FieldDescription>
              {isEditing
                ? "Update pricing, stock level, and safety stock threshold."
                : "Set the default pricing and starting inventory."}
            </FieldDescription>
            <FieldGroup>
              <div className="grid gap-4 md:grid-cols-2">
                {itemType === "material" && (
                  <Controller
                    name="defaultPurchasePrice"
                    control={form.control}
                    render={({ field, fieldState }) => (
                      <Field data-invalid={fieldState.invalid}>
                        <FieldLabel htmlFor={field.name}>
                          Purchase Price
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
                )}

                <Controller
                  name="defaultSellingPrice"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor={field.name}>
                        Selling Price
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
                      <FieldLabel htmlFor={field.name}>Stock</FieldLabel>
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
                      <FieldLabel htmlFor={field.name}>Safety Stock</FieldLabel>
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
          </FieldSet>

          {itemType === "product" && availableComponents && (
            <>
              <FieldSeparator />
              <FieldSet className="gap-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1.5">
                    <FieldLegend>Recipe / Bill of Materials</FieldLegend>
                    <FieldDescription>
                      {watchedManufacturingMode === "batch"
                        ? "Ingredients needed to produce one batch of this product."
                        : "Ingredients needed to produce one unit of this product."}
                    </FieldDescription>
                  </div>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="mt-0.5 shrink-0"
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
                          ? "Recipe is locked. Click to unlock."
                          : "Recipe is unlocked. Click to lock."
                        : "Inventory admin access is required to lock or unlock recipes."}
                    </TooltipContent>
                  </Tooltip>
                </div>
                <BomEditor
                  control={form.control}
                  availableComponents={availableComponents}
                  manufacturingMode={watchedManufacturingMode ?? "discrete"}
                />
                {isBomDirty ? (
                  <FieldGroup>
                    <Field>
                      <FieldDescription>
                        Saving recipe changes will create a new BOM revision.
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
                          ) : (
                            <FieldDescription>
                              Optional context shown in BOM revision history.
                            </FieldDescription>
                          )}
                        </Field>
                      )}
                    />
                  </FieldGroup>
                ) : null}
              </FieldSet>
            </>
          )}

          {itemType === "product" && (
            <>
              <FieldSeparator />
              <FieldSet className="max-w-4xl gap-5">
                <FieldLegend>Manufacturing</FieldLegend>
                <FieldDescription>
                  How this product is manufactured.
                </FieldDescription>
                <FieldGroup>
                  <Controller
                    control={form.control}
                    name="manufacturingMode"
                    render={({ field }) => (
                      <Field>
                        <FieldLabel htmlFor={field.name}>Manufacturing Mode</FieldLabel>
                        <Select
                          value={field.value ?? "discrete"}
                          onValueChange={(value) => {
                            field.onChange(value);
                            if (value === "discrete") {
                              form.setValue("expectedBatchYield", null, {
                                shouldDirty: true,
                              });
                            }
                          }}
                        >
                          <SelectTrigger id={field.name} className="w-48">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="discrete">Discrete</SelectItem>
                            <SelectItem value="batch">Batch</SelectItem>
                          </SelectContent>
                        </Select>
                        <FieldDescription>
                          {watchedManufacturingMode === "batch"
                            ? "Produced in fixed batches. BOM quantities are per batch."
                            : "Produced per unit. BOM quantities are per finished unit."}
                        </FieldDescription>
                      </Field>
                    )}
                  />
                  {watchedManufacturingMode === "batch" && (
                    <Controller
                      control={form.control}
                      name="expectedBatchYield"
                      render={({ field, fieldState }) => (
                        <Field data-invalid={fieldState.invalid}>
                          <FieldLabel htmlFor={field.name}>Expected Batch Yield</FieldLabel>
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
                          <FieldDescription>
                            Number of finished units produced per batch.
                          </FieldDescription>
                          {fieldState.invalid && (
                            <FieldError errors={[fieldState.error]} />
                          )}
                        </Field>
                      )}
                    />
                  )}
                </FieldGroup>
              </FieldSet>
            </>
          )}
        </FieldGroup>
      </form>
      <AlertDialog
        open={bomLockConfirmOpen}
        onOpenChange={(open) => {
          setBomLockConfirmOpen(open);
          if (!open) {
            setPendingBomLocked(null);
          }
        }}
      >
        <AlertDialogContent className="bg-background text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>{lockDialogTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {lockDialogDescription}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Back</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingBomLocked == null) return;

                form.setValue("bomLocked", pendingBomLocked, {
                  shouldDirty: true,
                  shouldTouch: true,
                });
                setPendingBomLocked(null);
              }}
            >
              {lockTarget ? "Lock BOM" : "Unlock BOM"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Dialog
        open={isUnitDialogOpen}
        onOpenChange={(open) => {
          setIsUnitDialogOpen(open);
          if (!open) {
            resetUnitForm();
            setUnitError(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Create Unit</DialogTitle>
            <DialogDescription>
              Define a new unit of measure for your inventory.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="unit-name">Name</FieldLabel>
              <Input
                id="unit-name"
                value={unitName}
                onChange={(e) => setUnitName(e.target.value)}
                placeholder="e.g. bag"
                autoComplete="off"
              />
            </Field>
            <Field data-invalid={unitSizeInvalid}>
              <FieldLabel htmlFor="unit-size">Size</FieldLabel>
              <Input
                id="unit-size"
                value={unitSize}
                onChange={(e) => setUnitSize(e.target.value)}
                placeholder="e.g. 1"
                inputMode="decimal"
                autoComplete="off"
                aria-invalid={unitSizeInvalid}
              />
              {unitSizeInvalid && (
                <FieldError>Must be a positive number</FieldError>
              )}
            </Field>
            <Field>
              <FieldLabel htmlFor="unit-uom">Unit of Measure</FieldLabel>
              <Select value={unitUom} onValueChange={setUnitUom}>
                <SelectTrigger id="unit-uom" className="w-full">
                  <SelectValue placeholder="Select a unit of measure" />
                </SelectTrigger>
                <SelectContent>
                  {uomGroups.map((group) => (
                    <SelectGroup key={group.category}>
                      <SelectLabel>{group.category}</SelectLabel>
                      {group.options.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </FieldGroup>
          {unitError && <FieldError>{unitError}</FieldError>}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button
              type="button"
              onClick={() => unitMutation.mutate()}
              disabled={
                unitMutation.isPending ||
                !unitName.trim() ||
                !POSITIVE_NUMBER_RE.test(unitSize.trim()) ||
                !unitUom
              }
            >
              {unitMutation.isPending ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
