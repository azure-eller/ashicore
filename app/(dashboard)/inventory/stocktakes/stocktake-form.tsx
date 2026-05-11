"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSmartBack } from "@/lib/hooks/use-smart-back";
import { Controller, useForm } from "react-hook-form";
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
  insertStocktakeSchema,
  stocktakeDefaultValues,
  type StocktakeScope,
} from "@/lib/schemas/stocktakes";
import { getFirstFormErrorMessage } from "@/lib/format";
import { STOCKTAKE_SCOPE_TOOLTIP } from "@/lib/tooltip-copy";
import { buildStocktakeName, type StocktakeScopeOptionGroup } from "./types";

type ApiError = {
  error?: string;
  errors?: Record<string, string[]>;
};

type StocktakeFormValues = z.input<typeof insertStocktakeSchema>;

export function StocktakeForm({
  scopeGroups,
}: {
  scopeGroups: StocktakeScopeOptionGroup[];
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const [nameDate] = useState(() => new Date());

  const form = useForm<StocktakeFormValues>({
    resolver: zodResolver(insertStocktakeSchema),
    mode: "onBlur",
    defaultValues: {
      ...stocktakeDefaultValues,
      name: buildStocktakeName(stocktakeDefaultValues.scope, nameDate),
    },
  });

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
            (values) => mutation.mutate(values),
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
        </form>
      </CreatePageGrid>
    </CreatePageShell>
  );
}
