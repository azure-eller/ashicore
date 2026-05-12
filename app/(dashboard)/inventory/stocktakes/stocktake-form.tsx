"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useSmartBack } from "@/lib/hooks/use-smart-back";
import { Controller, useForm, useWatch } from "react-hook-form";
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
import { TooltipHeader } from "@/components/tooltip-header";
import {
  createStocktakeSchema,
  parseStocktakeScope,
  stocktakeDefaultValues,
  type StocktakeScope,
} from "@/lib/schemas/stocktakes";
import { formatQuantity, getFirstFormErrorMessage } from "@/lib/format";
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

type StocktakeFormValues = z.input<typeof createStocktakeSchema>;

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
  const [removedItemIdsByScope, setRemovedItemIdsByScope] = useState<
    Record<string, string[]>
  >({});

  const form = useForm<StocktakeFormValues>({
    resolver: zodResolver(createStocktakeSchema),
    mode: "onBlur",
    defaultValues: {
      ...stocktakeDefaultValues,
      name: buildStocktakeName(stocktakeDefaultValues.scope, nameDate),
    },
  });
  const selectedScope = useWatch({ control: form.control, name: "scope" });

  const visiblePreviewItems = useMemo(() => {
    const parsed = parseStocktakeScope(selectedScope as StocktakeScope);
    const removed = new Set(removedItemIdsByScope[selectedScope] ?? []);

    return previewItems.filter((item) => {
      if (removed.has(item.id)) {
        return false;
      }

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
  }, [previewItems, removedItemIdsByScope, selectedScope]);

  const removePreviewItem = (itemId: string) => {
    setRemovedItemIdsByScope((current) => ({
      ...current,
      [selectedScope]: [...new Set([...(current[selectedScope] ?? []), itemId])],
    }));
  };

  const mutation = useMutation<{ id: string }, ApiError, StocktakeFormValues>({
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
          <Button type="submit" form="stocktake-form" disabled={mutation.isPending}>
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
            (values) =>
              mutation.mutate({
                ...values,
                itemIds: visiblePreviewItems.map((item) => item.id),
              }),
            handleInvalidSubmit
          )}
        >
          <CreateSection
            title="Basics"
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

          <CreateSection title="Lines">
            <div className="overflow-x-auto rounded-lg border">
              <div className="min-w-[42rem] divide-y">
                {visiblePreviewItems.length > 0 ? (
                  visiblePreviewItems.map((item) => (
                    <div
                      key={item.id}
                      className="grid grid-cols-[minmax(16rem,1fr)_8rem_8rem_7rem] items-center gap-4 px-4 py-3 text-sm"
                    >
                      <div>
                        <div className="font-medium">{item.name}</div>
                        {item.sku ? (
                          <div className="text-xs text-muted-foreground">{item.sku}</div>
                        ) : null}
                      </div>
                      <div className="capitalize text-muted-foreground">
                        {item.stocktakeType === "subassembly"
                          ? "Sub assembly"
                          : item.stocktakeType}
                      </div>
                      <div className="text-muted-foreground">{item.unitName}</div>
                      <div className="flex items-center justify-end gap-3">
                        <span>{formatQuantity(item.currentQty)}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removePreviewItem(item.id)}
                        >
                          Remove
                        </Button>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                    No items selected.
                  </div>
                )}
              </div>
            </div>
          </CreateSection>
        </form>
      </CreatePageGrid>
    </CreatePageShell>
  );
}
