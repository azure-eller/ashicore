"use client";

import { useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { insertItemSchema, type InsertItem } from "@/lib/schemas/items";
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

interface MaterialFormProps {
  units: { id: string; name: string; size: string; uom: string }[];
  categories: string[];
}

export function MaterialForm({ units, categories }: MaterialFormProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [categoryInput, setCategoryInput] = useState("");
  const [localUnits, setLocalUnits] = useState(units);
  const [isUnitDialogOpen, setIsUnitDialogOpen] = useState(false);
  const [unitName, setUnitName] = useState("");
  const [unitSize, setUnitSize] = useState("");
  const [unitUom, setUnitUom] = useState("");
  const [isCreatingUnit, setIsCreatingUnit] = useState(false);
  const [unitError, setUnitError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const uomGroups = useMemo(() => getUomOptions(), []);

  const categoryItems = useMemo(() => {
    const trimmed = categoryInput.trim();
    const lowerTrimmed = trimmed.toLowerCase();
    const hasExactMatch = categories.some(
      (c) => c.toLowerCase() === lowerTrimmed
    );
    if (trimmed && !hasExactMatch) {
      return [...categories, trimmed];
    }
    return categories;
  }, [categoryInput, categories]);

  const form = useForm<InsertItem>({
    resolver: zodResolver(insertItemSchema),
    mode: "onBlur",
    defaultValues: {
      name: "",
      itemType: "material",
      inStock: "0",
    },
  });

  const mutation = useMutation({
    mutationFn: async (data: InsertItem) => {
      const res = await fetch("/api/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(
          err.errors ? JSON.stringify(err.errors) : "Failed to create material"
        );
      }
      return res.json();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["items", "material"] });
      router.push("/inventory/materials");
    },
    onError: (err) => {
      setMutationError(err instanceof Error ? err.message : "Failed to create material");
    },
  });

  const handleCreateUnit = useCallback(async () => {
    if (!unitName.trim() || !unitSize.trim() || !unitUom) return;
    setIsCreatingUnit(true);
    setUnitError(null);
    try {
      const res = await fetch("/api/units", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: unitName, size: unitSize, uom: unitUom }),
      });
      if (!res.ok) {
        throw new Error("Failed to create unit");
      }
      const newUnit = await res.json();
      setLocalUnits((prev) => [...prev, newUnit]);
      form.setValue("unitDefinitionId", newUnit.id);
      setIsUnitDialogOpen(false);
      setUnitName("");
      setUnitSize("");
      setUnitUom("");
    } catch (err) {
      setUnitError(err instanceof Error ? err.message : "Failed to create unit");
    } finally {
      setIsCreatingUnit(false);
    }
  }, [unitName, unitSize, unitUom, form]);

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Add Material</CardTitle>
        <CardDescription>
          Create a new material in your inventory.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          id="create-material-form"
          onSubmit={form.handleSubmit((data) => {
            setMutationError(null);
            mutation.mutate(data);
          })}
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
                      onValueChange={field.onChange}
                      onInputValueChange={setCategoryInput}
                    >
                      <ComboboxInput
                        id={field.name}
                        placeholder="Search or create category..."
                      />
                      <ComboboxContent>
                        <ComboboxEmpty>
                          Type to create a new category
                        </ComboboxEmpty>
                        <ComboboxList>
                          {(item: string) => (
                            <ComboboxItem key={item} value={item}>
                              {categories.includes(item)
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
                      if (value === "__create_new__") {
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
                          {u.name} ({u.size} {u.uom})
                        </SelectItem>
                      ))}
                      <SelectSeparator />
                      <SelectItem value="__create_new__">
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

            <FieldSeparator />

            <FieldSet>
              <FieldLegend>Pricing & Stock</FieldLegend>
              <FieldDescription>
                Set the default purchase price and starting inventory.
              </FieldDescription>
              <div className="grid grid-cols-2 gap-4">
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

                <Controller
                  name="inStock"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor={field.name}>
                        Initial Stock
                      </FieldLabel>
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
              </div>
            </FieldSet>
          </FieldGroup>
        </form>
      </CardContent>
      <CardFooter className="flex flex-col items-end gap-3">
        {mutationError && (
          <p className="text-sm text-destructive">{mutationError}</p>
        )}
        <div className="flex gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.back()}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            form="create-material-form"
            disabled={mutation.isPending}
          >
            {mutation.isPending ? "Creating..." : "Create Material"}
          </Button>
        </div>
      </CardFooter>
      <Dialog open={isUnitDialogOpen} onOpenChange={setIsUnitDialogOpen}>
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
            <Field>
              <FieldLabel htmlFor="unit-size">Size</FieldLabel>
              <Input
                id="unit-size"
                value={unitSize}
                onChange={(e) => setUnitSize(e.target.value)}
                placeholder="e.g. 1"
                inputMode="decimal"
                autoComplete="off"
              />
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
          {unitError && (
            <p className="text-sm text-destructive">{unitError}</p>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button
              type="button"
              onClick={handleCreateUnit}
              disabled={isCreatingUnit}
            >
              {isCreatingUnit ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
