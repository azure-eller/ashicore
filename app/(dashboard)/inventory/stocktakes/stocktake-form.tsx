"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useSmartBack } from "@/lib/hooks/use-smart-back";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon, Cancel01Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import {
  CreatePageGrid,
  CreatePageHeader,
  CreatePageShell,
  CreateSection,
  CreateSidebarCard,
} from "@/components/create-page";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  EditableLineGrid,
  EditableLineGridCell,
  EditableLineGridRow,
} from "@/components/editable-line-grid";
import { InventoryItemCombobox } from "@/components/inventory-item-combobox";
import { TooltipHeader } from "@/components/tooltip-header";
import {
  createStocktakeSchema,
  parseStocktakeScope,
  stocktakeDefaultValues,
  type StocktakeScope,
} from "@/lib/schemas/stocktakes";
import {
  formatQuantity,
  getFieldArrayError,
  getFirstFormErrorMessage,
} from "@/lib/format";
import { STOCKTAKE_SCOPE_TOOLTIP } from "@/lib/tooltip-copy";
import {
  buildStocktakeName,
  type StocktakePreviewItem,
  type StocktakeScopeOptionGroup,
} from "./types";

type ApiError = {
  error?: string;
  errors?: Record<string, string[]>;
};

const stocktakeFormSchema = createStocktakeSchema
  .omit({ itemIds: true })
  .extend({
    lines: z
      .array(
        z.object({
          itemId: z.string().uuid("Choose an item"),
        })
      )
      .min(1, "Add at least one item"),
  })
  .superRefine((values, ctx) => {
    const seen = new Set<string>();

    values.lines.forEach((line, index) => {
      if (!line.itemId || seen.has(line.itemId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: line.itemId ? "Item is already selected" : "Choose an item",
          path: ["lines", index, "itemId"],
        });
        return;
      }

      seen.add(line.itemId);
    });
  });

type StocktakeFormValues = z.input<typeof stocktakeFormSchema>;

function getItemsForScope(
  scope: StocktakeScope,
  previewItems: StocktakePreviewItem[]
) {
  const parsed = parseStocktakeScope(scope);

  return previewItems.filter((item) => {
    if (parsed.kind === "type") {
      return item.stocktakeType === parsed.itemType;
    }

    if (parsed.kind === "category") {
      return (
        item.stocktakeType === parsed.itemType &&
        item.category === parsed.category
      );
    }

    return true;
  });
}

function stocktakeTypeLabel(item: StocktakePreviewItem) {
  return item.stocktakeType === "subassembly"
    ? "Sub assembly"
    : item.stocktakeType === "material"
      ? "Material"
      : "Product";
}

export function StocktakeForm({
  previewItems,
  scopeGroups,
}: {
  previewItems: StocktakePreviewItem[];
  scopeGroups: StocktakeScopeOptionGroup[];
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const [nameDate] = useState(() => new Date());

  const form = useForm<StocktakeFormValues>({
    resolver: zodResolver(stocktakeFormSchema),
    mode: "onBlur",
    defaultValues: {
      ...stocktakeDefaultValues,
      name: buildStocktakeName(stocktakeDefaultValues.scope, nameDate),
      lines: getItemsForScope(stocktakeDefaultValues.scope, previewItems).map(
        (item) => ({ itemId: item.id })
      ),
    },
  });
  const watchedLines = useWatch({ control: form.control, name: "lines" });
  const selectedLines = useMemo(() => watchedLines ?? [], [watchedLines]);
  const {
    fields: lineFields,
    append,
    remove,
    replace,
  } = useFieldArray({
    control: form.control,
    name: "lines",
  });

  const previewItemById = useMemo(
    () => new Map(previewItems.map((item) => [item.id, item])),
    [previewItems]
  );
  const selectedItemIds = useMemo(
    () => new Set(selectedLines.map((line) => line.itemId).filter(Boolean)),
    [selectedLines]
  );

  const mutation = useMutation<{ id: string }, ApiError, StocktakeFormValues>({
    mutationFn: async (values) => {
      const response = await fetch("/api/stocktakes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: values.name,
          scope: values.scope,
          notes: values.notes,
          itemIds: values.lines.map((line) => line.itemId),
        }),
      });

      const body = await response.json().catch(() => null);

      if (!response.ok) {
        throw {
          error: body?.error ?? "Failed to create stocktake.",
          errors: body?.errors,
        } satisfies ApiError;
      }

      return body as { id: string };
    },
    onMutate: () => {
      setFormError(null);
      form.clearErrors();
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["stocktakes"] });
      router.push(`/inventory/stocktakes/${result.id}`);
    },
    onError: (error: ApiError) => {
      if (error.errors) {
        setFormError(error.error ?? "Fix the highlighted fields.");
        Object.entries(error.errors).forEach(([field, messages]) => {
          form.setError(field as keyof StocktakeFormValues, {
            type: "server",
            message: messages[0],
          });
        });
        return;
      }

      setFormError(error.error ?? "Failed to create stocktake.");
    },
  });

  const handleInvalidSubmit = (errors: typeof form.formState.errors) => {
    setFormError(
      getFirstFormErrorMessage(errors) ?? "Fix the highlighted fields."
    );
  };

  const handleCancel = useSmartBack("/inventory/stocktakes");
  const linesError = getFieldArrayError(form.formState.errors.lines);

  return (
    <CreatePageShell>
      <CreatePageHeader
        eyebrow="Inventory · Stocktakes"
        title="New Stocktake"
        actions={
          <>
            <Button type="button" variant="outline" onClick={handleCancel}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="stocktake-form"
              disabled={mutation.isPending}
            >
              {mutation.isPending ? "Creating..." : "Create Stocktake"}
            </Button>
          </>
        }
      />

      {formError && <FieldError>{formError}</FieldError>}

      <CreatePageGrid
        sidebar={
          <CreateSidebarCard title="How it works">
            <div className="space-y-4">
              {[
                {
                  title: "Snapshot",
                  description:
                    "Available stock is captured the moment you create the stocktake.",
                },
                {
                  title: "Count",
                  description:
                    "Walk the floor and enter counted quantities row by row.",
                },
                {
                  title: "Apply",
                  description:
                    "Completing it writes counted totals to live stock.",
                },
              ].map((step, index) => (
                <div key={step.title} className="flex gap-3">
                  <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                    {index + 1}
                  </div>
                  <div className="space-y-0.5">
                    <div className="text-sm font-medium">{step.title}</div>
                    <p className="text-xs leading-5 text-muted-foreground">
                      {step.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CreateSidebarCard>
        }
      >
        <form
          id="stocktake-form"
          onSubmit={form.handleSubmit(
            (values) => mutation.mutate(values),
            handleInvalidSubmit
          )}
        >
          <CreateSection title="Basics">
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
                      value={field.value ?? ""}
                      aria-invalid={fieldState.invalid}
                      placeholder="Quarterly inventory count"
                      autoComplete="off"
                    />
                    {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                  </Field>
                )}
              />

              <Controller
                name="scope"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor={field.name}>
                      <TooltipHeader label="Scope" tooltip={STOCKTAKE_SCOPE_TOOLTIP} />
                    </FieldLabel>
                    <Select
                      name={field.name}
                      value={field.value}
                      onValueChange={(value) => {
                        const scope = value as StocktakeScope;
                        field.onChange(value);
                        replace(
                          getItemsForScope(scope, previewItems).map((item) => ({
                            itemId: item.id,
                          }))
                        );
                        form.setValue(
                          "name",
                          buildStocktakeName(scope, nameDate),
                          { shouldDirty: true, shouldValidate: true }
                        );
                      }}
                    >
                      <SelectTrigger
                        id={field.name}
                        className="w-full"
                        aria-invalid={fieldState.invalid}
                      >
                        <SelectValue placeholder="Select scope" />
                      </SelectTrigger>
                      <SelectContent>
                        {scopeGroups.map((group) => (
                          <SelectGroup key={group.label}>
                            <SelectLabel>{group.label}</SelectLabel>
                            {group.options.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        ))}
                      </SelectContent>
                    </Select>
                    {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                  </Field>
                )}
              />

              <Controller
                name="notes"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor={field.name}>Notes</FieldLabel>
                    <Textarea
                      {...field}
                      id={field.name}
                      value={field.value ?? ""}
                      aria-invalid={fieldState.invalid}
                      placeholder="Optional context for the team"
                    />
                    {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                  </Field>
                )}
              />
            </FieldGroup>
          </CreateSection>

          <CreateSection title="Lines">
            <div className="space-y-3">
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => append({ itemId: "" })}
                >
                  Add Item
                  <HugeiconsIcon
                    icon={Add01Icon}
                    className="h-4 w-4"
                    data-icon="inline-end"
                    aria-hidden
                  />
                </Button>
              </div>

              {linesError ? <FieldError>{linesError}</FieldError> : null}

              <EditableLineGrid
                columns="minmax(18rem,1fr) 8rem 8rem 8rem 3rem"
                headers={["Item", "Type", "Unit", "Available", ""]}
                minWidth="48rem"
              >
                {lineFields.length > 0 ? (
                  lineFields.map((line, index) => {
                    const selectedItem = previewItemById.get(
                      selectedLines[index]?.itemId
                    );
                    const availableOptions = previewItems.filter(
                      (item) =>
                        item.id === selectedLines[index]?.itemId ||
                        !selectedItemIds.has(item.id)
                    );

                    return (
                      <EditableLineGridRow key={line.id}>
                        <EditableLineGridCell>
                          <Controller
                            control={form.control}
                            name={`lines.${index}.itemId`}
                            render={({ field, fieldState }) => (
                              <Field data-invalid={fieldState.invalid}>
                                <FieldLabel
                                  className="sr-only"
                                  htmlFor={`stocktake-line-${line.id}-item`}
                                >
                                  Item
                                </FieldLabel>
                                <InventoryItemCombobox
                                  options={availableOptions}
                                  value={field.value ?? ""}
                                  onValueChange={(value) =>
                                    field.onChange(value ?? "")
                                  }
                                  inputId={`stocktake-line-${line.id}-item`}
                                  inputAriaInvalid={fieldState.invalid}
                                  inputClassName="w-full min-w-0"
                                  placeholder="Search items..."
                                  emptyMessage="No items found"
                                  contentClassName="w-[min(36rem,calc(100vw-2rem))]"
                                  showTypeBadge
                                  createLinks={[
                                    {
                                      href: "/inventory/products/new",
                                      label: "Create product",
                                    },
                                    {
                                      href: "/inventory/materials/new",
                                      label: "Create material",
                                    },
                                  ]}
                                  getSecondaryText={(item) =>
                                    [
                                      item.sku,
                                      item.unitName,
                                      `Available ${formatQuantity(
                                        item.currentQty
                                      )}`,
                                    ]
                                      .filter(
                                        (part): part is string =>
                                          part != null && part.trim() !== ""
                                      )
                                      .join(" · ")
                                  }
                                />
                                {selectedItem ? (
                                  <p className="mt-1 truncate text-xs text-muted-foreground">
                                    {selectedItem.sku
                                      ? `${selectedItem.sku} · `
                                      : ""}
                                    Available{" "}
                                    {formatQuantity(selectedItem.currentQty)}
                                  </p>
                                ) : null}
                                {fieldState.invalid ? (
                                  <FieldError errors={[fieldState.error]} />
                                ) : null}
                              </Field>
                            )}
                          />
                        </EditableLineGridCell>
                        <EditableLineGridCell className="text-sm text-muted-foreground">
                          {selectedItem ? stocktakeTypeLabel(selectedItem) : "-"}
                        </EditableLineGridCell>
                        <EditableLineGridCell className="text-sm text-muted-foreground">
                          {selectedItem?.unitName ?? "-"}
                        </EditableLineGridCell>
                        <EditableLineGridCell
                          align="right"
                          className="text-sm tabular-nums"
                        >
                          {selectedItem
                            ? formatQuantity(selectedItem.currentQty)
                            : "-"}
                        </EditableLineGridCell>
                        <EditableLineGridCell align="center">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => remove(index)}
                            aria-label="Remove item"
                          >
                            <HugeiconsIcon
                              icon={Cancel01Icon}
                              className="h-4 w-4"
                              aria-hidden
                            />
                          </Button>
                        </EditableLineGridCell>
                      </EditableLineGridRow>
                    );
                  })
                ) : (
                  <EditableLineGridRow>
                    <EditableLineGridCell className="col-span-full py-8 text-center text-sm text-muted-foreground">
                      No items selected.
                    </EditableLineGridCell>
                  </EditableLineGridRow>
                )}
              </EditableLineGrid>
            </div>
          </CreateSection>
        </form>
      </CreatePageGrid>
    </CreatePageShell>
  );
}
