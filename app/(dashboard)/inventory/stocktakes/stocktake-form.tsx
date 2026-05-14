"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useSmartBack } from "@/lib/hooks/use-smart-back";
import { Controller, useForm, useWatch, type Control, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  CreatePageGrid,
  CreatePageHeader,
  CreatePageShell,
  CreateSection,
  CreateSidebarCard,
} from "@/components/create-page";
import { EditableLineGridCell } from "@/components/editable-line-grid";
import {
  EditableLineItems,
} from "@/components/editable-line-items";
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
import { InventoryItemCombobox } from "@/components/inventory-item-combobox";
import { TooltipHeader } from "@/components/tooltip-header";
import {
  insertStocktakeSchema,
  parseStocktakeScope,
  stocktakeDefaultValues,
  type StocktakeScope,
} from "@/lib/schemas/stocktakes";
import { formatQuantity, getFirstFormErrorMessage } from "@/lib/format";
import {
  STOCKTAKE_CURRENT_QTY_TOOLTIP,
  STOCKTAKE_SCOPE_TOOLTIP,
  UNIT_TOOLTIP,
} from "@/lib/tooltip-copy";
import { TooltipHeader as TableTooltipHeader } from "@/components/tooltip-header";
import {
  buildStocktakeName,
  type StocktakePreviewItem,
  type StocktakeScopeOptionGroup,
} from "./types";

type ApiError = {
  error?: string;
  errors?: Record<string, string[]>;
};

type StocktakePreviewLine = {
  itemId: string;
};

type StocktakeCreatePayload = z.input<typeof insertStocktakeSchema>;
type StocktakeFormValues = StocktakeCreatePayload & {
  previewLines: StocktakePreviewLine[];
};

const STOCKTAKE_PREVIEW_GRID_COLUMNS =
  "minmax(14rem,1.5fr) minmax(6rem,0.55fr) minmax(7rem,0.65fr) minmax(7.5rem,0.75fr)";

const blankPreviewLine: StocktakePreviewLine = {
  itemId: "",
};

function isBlankPreviewLine(line: StocktakePreviewLine | undefined) {
  return (line?.itemId?.trim() ?? "") === "";
}

function itemMatchesScope(item: StocktakePreviewItem, scope: StocktakeScope) {
  const parsedScope = parseStocktakeScope(scope);

  if (parsedScope.kind === "all") {
    return true;
  }

  if (parsedScope.kind === "type") {
    return item.stocktakeType === parsedScope.itemType;
  }

  return item.stocktakeType === parsedScope.itemType && item.category === parsedScope.category;
}

export function StocktakeForm({
  scopeGroups,
  previewItems,
}: {
  scopeGroups: StocktakeScopeOptionGroup[];
  previewItems: StocktakePreviewItem[];
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const [nameDate] = useState(() => new Date());

  const defaultPreviewLines = useMemo(
    () =>
      previewItems
        .filter((item) => itemMatchesScope(item, stocktakeDefaultValues.scope))
        .map((item) => ({ itemId: item.id })),
    [previewItems]
  );

  const form = useForm<StocktakeFormValues>({
    resolver: zodResolver(insertStocktakeSchema.passthrough()) as unknown as Resolver<StocktakeFormValues>,
    mode: "onBlur",
    defaultValues: {
      ...stocktakeDefaultValues,
      name: buildStocktakeName(stocktakeDefaultValues.scope, nameDate),
      previewLines: defaultPreviewLines,
    },
  });

  const watchedScope = useWatch({
    control: form.control,
    name: "scope",
  });
  const watchedPreviewLines = useWatch({
    control: form.control,
    name: "previewLines",
  });

  const previewItemMap = useMemo(
    () => new Map(previewItems.map((item) => [item.id, item])),
    [previewItems]
  );
  const selectedItemIds = useMemo(
    () =>
      Array.from(
        new Set(
          (watchedPreviewLines ?? [])
            .map((line) => line?.itemId)
            .filter((itemId): itemId is string => Boolean(itemId))
        )
      ),
    [watchedPreviewLines]
  );
  const selectedItemCount = selectedItemIds.length;

  useEffect(() => {
    form.setValue(
      "previewLines",
      previewItems
        .filter((item) => itemMatchesScope(item, watchedScope as StocktakeScope))
        .map((item) => ({ itemId: item.id })),
      { shouldDirty: true, shouldValidate: true }
    );
  }, [form, previewItems, watchedScope]);

  const mutation = useMutation<{ id: string }, ApiError, StocktakeCreatePayload>({
    mutationFn: async (values) => {
      const response = await fetch("/api/stocktakes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
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
  const handleSubmit = form.handleSubmit((values) => {
    const itemIds = Array.from(
      new Set(
        values.previewLines
          .map((line) => line.itemId)
          .filter((itemId): itemId is string => itemId.trim() !== "")
      )
    );

    mutation.mutate({
      name: values.name,
      scope: values.scope,
      notes: values.notes,
      itemIds,
    });
  }, handleInvalidSubmit);

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
            disabled={mutation.isPending || selectedItemCount === 0}
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
          onSubmit={handleSubmit}
        >
          <FieldGroup className="gap-6">
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
                        field.onChange(value);
                        form.setValue(
                          "name",
                          buildStocktakeName(value as StocktakeScope, nameDate),
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

          <CreateSection
            title="Preview"
            action={
              <span className="text-xs text-muted-foreground">
                {selectedItemCount} item{selectedItemCount === 1 ? "" : "s"}
              </span>
            }
          >
            <EditableLineItems<StocktakeFormValues, "previewLines">
              control={form.control}
              name="previewLines"
              columns={STOCKTAKE_PREVIEW_GRID_COLUMNS}
              minWidth="38rem"
              headers={[
                "Item",
                "Type",
                <TableTooltipHeader key="unit" label="Unit" tooltip={UNIT_TOOLTIP} />,
                <TableTooltipHeader
                  key="available"
                  label="Available"
                  tooltip={STOCKTAKE_CURRENT_QTY_TOOLTIP}
                />,
              ]}
              createLine={() => ({ ...blankPreviewLine })}
              isLineBlank={isBlankPreviewLine}
              addLabel="Add item"
              emptyMessage="No items selected yet."
              enableReorder={false}
              error={
                selectedItemCount === 0
                  ? "Choose at least one item for this stocktake."
                  : null
              }
              renderRow={({ field, index }) => (
                <StocktakePreviewRow
                  key={field.id}
                  lineKey={field.id}
                  index={index}
                  control={form.control}
                  items={previewItems}
                  itemMap={previewItemMap}
                  selectedItemIds={selectedItemIds}
                />
              )}
              footer={
                <div className="text-sm">
                  <span className="text-muted-foreground">Snapshot items</span>{" "}
                  <span className="font-mono font-medium tabular-nums">
                    {selectedItemCount}
                  </span>
                </div>
              }
            />
          </CreateSection>
          </FieldGroup>
        </form>
      </CreatePageGrid>
    </CreatePageShell>
  );
}

function StocktakePreviewRow({
  lineKey,
  index,
  control,
  items,
  itemMap,
  selectedItemIds,
}: {
  lineKey: string;
  index: number;
  control: Control<StocktakeFormValues>;
  items: StocktakePreviewItem[];
  itemMap: Map<string, StocktakePreviewItem>;
  selectedItemIds: string[];
}) {
  const itemId = useWatch({
    control,
    name: `previewLines.${index}.itemId`,
  });
  const item = itemId ? itemMap.get(itemId) : undefined;
  const options = items.filter(
    (option) => option.id === itemId || !selectedItemIds.includes(option.id)
  );

  return (
    <>
      <EditableLineGridCell>
        <Controller
          name={`previewLines.${index}.itemId`}
          control={control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel className="sr-only" htmlFor={`${lineKey}-item`}>
                Item
              </FieldLabel>
              <InventoryItemCombobox
                options={options}
                value={field.value ?? ""}
                onValueChange={(value) => field.onChange(value ?? "")}
                inputId={`${lineKey}-item`}
                inputAriaInvalid={fieldState.invalid}
                inputPrimaryFocus
                inputClassName="w-full min-w-0"
                placeholder="Search items..."
                emptyMessage="No active items found"
                contentClassName="w-[min(36rem,calc(100vw-2rem))]"
                showTypeBadge
                getSecondaryText={(current) =>
                  [
                    current.sku,
                    current.unitName,
                    `Available ${formatQuantity(current.currentQty)}`,
                  ]
                    .filter((part): part is string => part != null && part !== "")
                    .join(" · ")
                }
              />
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />
      </EditableLineGridCell>
      <EditableLineGridCell className="text-sm text-muted-foreground">
        {item?.itemType ?? "—"}
      </EditableLineGridCell>
      <EditableLineGridCell className="text-sm text-muted-foreground">
        {item?.unitName ?? "—"}
      </EditableLineGridCell>
      <EditableLineGridCell className="font-mono text-sm tabular-nums">
        {item ? formatQuantity(item.currentQty) : "—"}
      </EditableLineGridCell>
    </>
  );
}
