"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSmartBack } from "@/lib/hooks/use-smart-back";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  insertSupplierSchema,
  supplierDefaultValues,
  updateSupplierSchema,
} from "@/lib/schemas/suppliers";
import type { SupplierRow } from "./types";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { Separator } from "@/components/ui/separator";
import { SupplierFieldGroups, type SupplierFormValues } from "./supplier-fields";

type ApiError = {
  error?: string;
  errors?: Record<string, string[]>;
};

export function SupplierForm({ initialData }: { initialData?: SupplierRow }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const isEditing = Boolean(initialData);
  const fallbackPath = initialData
    ? `/purchasing/suppliers/${initialData.id}`
    : "/purchasing/suppliers";
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<SupplierFormValues>({
    resolver: zodResolver(initialData ? updateSupplierSchema : insertSupplierSchema),
    mode: "onBlur",
    defaultValues: initialData
      ? {
          name: initialData.name,
          code: initialData.code,
          contactName: initialData.contactName,
          email: initialData.email,
          phone: initialData.phone,
          billingLine1: initialData.billingLine1,
          billingLine2: initialData.billingLine2,
          billingCity: initialData.billingCity,
          billingRegion: initialData.billingRegion,
          billingPostcode: initialData.billingPostcode,
          billingCountry: initialData.billingCountry,
          paymentTerms: initialData.paymentTerms,
          notes: initialData.notes,
        }
      : supplierDefaultValues,
  });

  const mutation = useMutation({
    mutationFn: async (values: SupplierFormValues) => {
      const response = await fetch(
        initialData ? `/api/suppliers/${initialData.id}` : "/api/suppliers",
        {
          method: initialData ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(values),
        }
      );

      const body = await response.json().catch(() => null);

      if (!response.ok) {
        throw {
          error: body?.error ?? "Failed to save supplier.",
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
      await queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      router.push(initialData ? fallbackPath : `/purchasing/suppliers/${result.id}`);
    },
    onError: (error: ApiError) => {
      if (error.errors) {
        Object.entries(error.errors).forEach(([field, messages]) => {
          form.setError(field as keyof SupplierFormValues, {
            type: "server",
            message: messages[0],
          });
        });
        return;
      }

      setFormError(error.error ?? "Failed to save supplier.");
    },
  });

  const handleCancel = useSmartBack(fallbackPath);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="space-y-1.5">
          <h1 className="text-3xl font-semibold tracking-tight">
            {isEditing ? "Edit Supplier" : "Add Supplier"}
          </h1>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <Button type="button" variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button type="submit" form="supplier-form" disabled={mutation.isPending}>
            {mutation.isPending
              ? isEditing
                ? "Saving..."
                : "Creating..."
              : isEditing
                ? "Save Changes"
                : "Create Supplier"}
          </Button>
        </div>
      </div>

      <Separator />

      {formError && <FieldError>{formError}</FieldError>}

      <form
        id="supplier-form"
        className="space-y-0"
        onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
      >
        <SupplierFieldGroups control={form.control} />
      </form>
    </div>
  );
}
