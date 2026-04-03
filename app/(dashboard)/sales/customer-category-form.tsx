"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { useSmartBack } from "@/lib/hooks/use-smart-back";
import {
  customerCategoryDefaultValues,
  insertCustomerCategorySchema,
} from "@/lib/schemas/customer-categories";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";

type CustomerCategoryFormValues = z.input<typeof insertCustomerCategorySchema>;

type CustomerCategoryInitialData = {
  id: string;
  name: string;
  description: string | null;
};

export function CustomerCategoryForm({
  initialData,
}: {
  initialData?: CustomerCategoryInitialData;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const isEditing = Boolean(initialData);
  const fallbackPath = "/sales/pricing";
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<CustomerCategoryFormValues>({
    resolver: zodResolver(insertCustomerCategorySchema),
    mode: "onBlur",
    defaultValues: initialData
      ? {
          name: initialData.name,
          description: initialData.description,
        }
      : customerCategoryDefaultValues,
  });

  const mutation = useMutation({
    mutationFn: async (values: CustomerCategoryFormValues) => {
      const response = await fetch(
        initialData
          ? `/api/customer-categories/${initialData.id}`
          : "/api/customer-categories",
        {
          method: initialData ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(values),
        }
      );

      const body = await response.json().catch(() => null);

      if (!response.ok) {
        throw {
          status: response.status,
          error: body?.error ?? "Failed to save customer category.",
          errors: body?.errors,
        };
      }

      return body as { id: string };
    },
    onMutate: () => {
      setFormError(null);
      form.clearErrors();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["customer-categories"] });
      router.push(fallbackPath);
    },
    onError: (error: { error?: string; errors?: Record<string, string[]> }) => {
      if (error.errors) {
        Object.entries(error.errors).forEach(([field, messages]) => {
          form.setError(field as keyof CustomerCategoryFormValues, {
            type: "server",
            message: messages[0],
          });
        });
        return;
      }

      setFormError(error.error ?? "Failed to save customer category.");
    },
  });

  const handleCancel = useSmartBack(fallbackPath);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="space-y-1.5">
          <h1 className="text-3xl font-semibold tracking-tight">
            {isEditing ? "Edit Customer Category" : "Add Customer Category"}
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            {isEditing
              ? "Update the category used to scope pricing schedules."
              : "Create a customer category for segment-based pricing."}
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <Button type="button" variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button type="submit" form="customer-category-form" disabled={mutation.isPending}>
            {mutation.isPending
              ? isEditing
                ? "Saving..."
                : "Creating..."
              : isEditing
                ? "Save Changes"
                : "Create Category"}
          </Button>
        </div>
      </div>

      <Separator />

      {formError && <FieldError>{formError}</FieldError>}

      <form
        id="customer-category-form"
        className="space-y-0"
        onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
      >
        <FieldGroup className="gap-8">
          <FieldSet className="max-w-4xl gap-5">
            <FieldLegend>Category</FieldLegend>
            <FieldDescription>
              Name the segment that pricing schedules will target.
            </FieldDescription>
            <FieldGroup>
              <Controller
                control={form.control}
                name="name"
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor={field.name}>Name</FieldLabel>
                    <Input
                      {...field}
                      id={field.name}
                      value={field.value ?? ""}
                      onChange={(event) => field.onChange(event.target.value)}
                      aria-invalid={fieldState.invalid}
                      autoComplete="off"
                    />
                    {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                  </Field>
                )}
              />

              <Controller
                control={form.control}
                name="description"
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor={field.name}>Description</FieldLabel>
                    <Textarea
                      {...field}
                      id={field.name}
                      value={field.value ?? ""}
                      onChange={(event) => field.onChange(event.target.value)}
                      aria-invalid={fieldState.invalid}
                      rows={5}
                    />
                    <FieldDescription>
                      Optional internal notes about when this category should be used.
                    </FieldDescription>
                    {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                  </Field>
                )}
              />
            </FieldGroup>
          </FieldSet>
        </FieldGroup>
      </form>
    </div>
  );
}
