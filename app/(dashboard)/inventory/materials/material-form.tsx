"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  insertItemSchema,
  updateItemWithStockSchema,
  type InsertItem,
  type UpdateItemWithStock,
} from "@/lib/schemas/items";
import { getUomOptions } from "@/lib/units-of-measure";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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

const CREATE_NEW_UNIT = "__create_new__";
const POSITIVE_NUMBER_RE = /^\d+\.?\d*$/;
const uomGroups = getUomOptions();

interface MaterialFormProps {
  units: { id: string; name: string; size: string; uom: string }[];
  categories: string[];
  initialData?: {
    id: string;
    name: string;
    sku: string | null;
    category: string | null;
    description: string | null;
    unitDefinitionId: string;
    unitName: string;
    unitSize: string;
    unitUom: string;
    defaultPurchasePrice: string | null;
    inStock: string;
  };
}

export function MaterialForm({ units, categories, initialData }: MaterialFormProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const redirectUrl = initialData
    ? `/inventory/materials/${initialData.id}`
    : "/inventory/materials";
  const [categoryInput, setCategoryInput] = useState("");
  const [localUnits, setLocalUnits] = useState(units);
  const [isUnitDialogOpen, setIsUnitDialogOpen] = useState(false);
  const [unitName, setUnitName] = useState("");
  const [unitSize, setUnitSize] = useState("");
  const [unitUom, setUnitUom] = useState("");
  const unitSizeInvalid = unitSize.trim() !== "" && !POSITIVE_NUMBER_RE.test(unitSize.trim());

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

  const form = useForm<InsertItem | UpdateItemWithStock>({
    resolver: zodResolver(initialData ? updateItemWithStockSchema : insertItemSchema),
    mode: "onBlur",
    defaultValues: initialData
      ? {
          name: initialData.name,
          sku: initialData.sku,
          category: initialData.category,
          description: initialData.description,
          defaultPurchasePrice: initialData.defaultPurchasePrice != null
            ? String(parseFloat(initialData.defaultPurchasePrice))
            : null,
          newStock: String(parseFloat(initialData.inStock)),
          stockAdjustmentCostPerUnit: initialData.defaultPurchasePrice,
        }
      : {
          name: "",
          itemType: "material" as const,
          unitDefinitionId: "",
          initialStock: "0",
        },
  });

  const watchedNewStock = form.watch("newStock");
  const currentStock = initialData ? parseFloat(initialData.inStock) : 0;
  const newStockValue = watchedNewStock != null && watchedNewStock !== ""
    ? parseFloat(watchedNewStock)
    : NaN;
  const stockChanged = initialData && !isNaN(newStockValue) && newStockValue !== currentStock;
  const stockIncreasing = initialData && !isNaN(newStockValue) && newStockValue > currentStock;

  const [formError, setFormError] = useState<string | null>(null);
  const [unitError, setUnitError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async (data: InsertItem | UpdateItemWithStock) => {
      const url = initialData ? `/api/items/${initialData.id}` : "/api/items";
      const method = initialData ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const fallback = initialData
          ? "Failed to update material."
          : "Failed to create material.";
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
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["items", "material"] });
      router.push(redirectUrl);
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
      setUnitName("");
      setUnitSize("");
      setUnitUom("");
      setUnitError(null);
    },
    onError: (error) => {
      setUnitError(error.message);
    },
    onMutate: () => {
      setUnitError(null);
    },
  });

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>{initialData ? "Edit Material" : "Add Material"}</CardTitle>
        <CardDescription>
          {initialData
            ? "Update this material's details."
            : "Create a new material in your inventory."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          id="material-form"
          onSubmit={form.handleSubmit((data) => { if (!mutation.isPending) mutation.mutate(data); })}
        >
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
                    placeholder="Optional notes about this material"
                    rows={2}
                    autoComplete="off"
                  />
                  {fieldState.invalid && (
                    <FieldError errors={[fieldState.error]} />
                  )}
                </Field>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
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
                <FieldLabel>Unit</FieldLabel>
                <p className="text-sm py-2">
                  {initialData.unitName} ({parseFloat(initialData.unitSize)} {initialData.unitUom})
                </p>
              </Field>
            ) : (
              <Controller
                name="unitDefinitionId"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor={field.name}>Unit</FieldLabel>
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
                        <SelectValue placeholder="Select a unit" />
                      </SelectTrigger>
                      <SelectContent>
                        {localUnits.map((u) => (
                          <SelectItem key={u.id} value={u.id}>
                            {u.name} ({parseFloat(u.size)} {u.uom})
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

            <FieldSeparator />

            <FieldSet>
              <FieldLegend>{initialData ? "Pricing" : "Pricing & Stock"}</FieldLegend>
              <FieldDescription>
                {initialData
                  ? "Update the default purchase price for this material."
                  : "Set the default purchase price and starting inventory."}
              </FieldDescription>
              <FieldGroup>
                <div className={initialData ? undefined : "grid grid-cols-2 gap-4"}>
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

                  {!initialData && (
                    <Controller
                      name="initialStock"
                      control={form.control}
                      render={({ field, fieldState }) => (
                        <Field data-invalid={fieldState.invalid}>
                          <FieldLabel htmlFor={field.name}>Initial Stock</FieldLabel>
                          <Input
                            {...field}
                            id={field.name}
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
                  )}
                </div>
              </FieldGroup>
            </FieldSet>

            {initialData && (
              <>
                <FieldSeparator />
                <FieldSet>
                  <FieldLegend>Stock</FieldLegend>
                  <FieldDescription>
                    Change the stock level. The system will create or adjust lots automatically.
                  </FieldDescription>
                  <FieldGroup>
                    <Field>
                      <FieldLabel>Current Stock</FieldLabel>
                      <p className="text-sm py-2">
                        {parseFloat(initialData.inStock)} {initialData.unitName}
                      </p>
                    </Field>

                    <Controller
                      name="newStock"
                      control={form.control}
                      render={({ field, fieldState }) => (
                        <Field data-invalid={fieldState.invalid}>
                          <FieldLabel htmlFor={field.name}>New Stock</FieldLabel>
                          <Input
                            {...field}
                            id={field.name}
                            value={field.value ?? ""}
                            aria-invalid={fieldState.invalid}
                            placeholder={String(parseFloat(initialData.inStock))}
                            inputMode="decimal"
                            autoComplete="off"
                          />
                          {fieldState.invalid && (
                            <FieldError errors={[fieldState.error]} />
                          )}
                        </Field>
                      )}
                    />

                    {stockChanged && (
                      <>
                        <Controller
                          name="stockAdjustmentReason"
                          control={form.control}
                          render={({ field, fieldState }) => (
                            <Field data-invalid={fieldState.invalid}>
                              <FieldLabel htmlFor={field.name}>Reason</FieldLabel>
                              <Select
                                name={field.name}
                                value={field.value ?? ""}
                                onValueChange={field.onChange}
                              >
                                <SelectTrigger
                                  id={field.name}
                                  aria-invalid={fieldState.invalid}
                                  className="w-full"
                                >
                                  <SelectValue placeholder="Select a reason" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="adjustment">Adjustment</SelectItem>
                                  <SelectItem value="return">Return</SelectItem>
                                  <SelectItem value="write_off">Write-off</SelectItem>
                                </SelectContent>
                              </Select>
                              {fieldState.invalid && (
                                <FieldError errors={[fieldState.error]} />
                              )}
                            </Field>
                          )}
                        />

                        {stockIncreasing && (
                          <Controller
                            name="stockAdjustmentCostPerUnit"
                            control={form.control}
                            render={({ field, fieldState }) => (
                              <Field data-invalid={fieldState.invalid}>
                                <FieldLabel htmlFor={field.name}>Cost / Unit</FieldLabel>
                                <Input
                                  {...field}
                                  id={field.name}
                                  value={field.value ?? ""}
                                  aria-invalid={fieldState.invalid}
                                  placeholder="Defaults to purchase price"
                                  inputMode="decimal"
                                  autoComplete="off"
                                />
                                <FieldDescription>
                                  Leave blank to use the default purchase price.
                                </FieldDescription>
                                {fieldState.invalid && (
                                  <FieldError errors={[fieldState.error]} />
                                )}
                              </Field>
                            )}
                          />
                        )}

                        <Controller
                          name="stockAdjustmentNotes"
                          control={form.control}
                          render={({ field, fieldState }) => (
                            <Field data-invalid={fieldState.invalid}>
                              <FieldLabel htmlFor={field.name}>Notes</FieldLabel>
                              <Textarea
                                {...field}
                                id={field.name}
                                value={field.value ?? ""}
                                aria-invalid={fieldState.invalid}
                                placeholder="Optional notes about this adjustment"
                                rows={2}
                                autoComplete="off"
                              />
                              {fieldState.invalid && (
                                <FieldError errors={[fieldState.error]} />
                              )}
                            </Field>
                          )}
                        />
                      </>
                    )}
                  </FieldGroup>
                </FieldSet>
              </>
            )}
          </FieldGroup>
        </form>
        {formError && <FieldError className="mt-2">{formError}</FieldError>}
      </CardContent>
      <CardFooter className="flex justify-end gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push(redirectUrl)}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          form="material-form"
          disabled={mutation.isPending}
        >
          {initialData
            ? (mutation.isPending ? "Saving..." : "Save Changes")
            : (mutation.isPending ? "Creating..." : "Create Material")}
        </Button>
      </CardFooter>
      <Dialog
        open={isUnitDialogOpen}
        onOpenChange={(open) => {
          setIsUnitDialogOpen(open);
          if (!open) {
            setUnitName("");
            setUnitSize("");
            setUnitUom("");
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
    </Card>
  );
}
