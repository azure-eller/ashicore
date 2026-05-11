"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  insertSupplierSchema,
  supplierDefaultValues,
} from "@/lib/schemas/suppliers";
import { getFirstFormErrorMessage } from "@/lib/format";
import type { SupplierOption } from "./types";
import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { SupplierFieldGroups, type SupplierFormValues } from "./supplier-fields";

type ApiError = {
  error?: string;
  errors?: Record<string, string[]>;
};

export function SupplierSelect({
  suppliers,
  value,
  onValueChange,
  onSupplierCreated,
  errorMessage,
}: {
  suppliers: SupplierOption[];
  value: string | null;
  onValueChange: (value: string | null) => void;
  onSupplierCreated: (supplier: SupplierOption) => void;
  errorMessage?: string;
}) {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const supplierIds = suppliers.map((supplier) => supplier.id);
  const supplierMap = new Map(suppliers.map((supplier) => [supplier.id, supplier]));

  const form = useForm<SupplierFormValues>({
    resolver: zodResolver(insertSupplierSchema),
    mode: "onBlur",
    defaultValues: supplierDefaultValues,
  });

  const mutation = useMutation({
    mutationFn: async (values: SupplierFormValues) => {
      const response = await fetch("/api/suppliers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });

      const body = await response.json().catch(() => null);

      if (!response.ok) {
        throw {
          error: body?.error ?? "Failed to create supplier.",
          errors: body?.errors,
        } satisfies ApiError;
      }

      return body as { id: string };
    },
    onMutate: () => {
      setDialogError(null);
      form.clearErrors();
    },
    onSuccess: async (result, values) => {
      await queryClient.invalidateQueries({ queryKey: ["suppliers"] });

      const createdSupplier = {
        id: result.id,
        name: values.name,
        code: values.code ?? null,
      } satisfies SupplierOption;

      onSupplierCreated(createdSupplier);
      onValueChange(result.id);
      form.reset(supplierDefaultValues);
      setDialogOpen(false);
    },
    onError: (error: ApiError) => {
      if (error.errors) {
        setDialogError(error.error ?? "Fix the highlighted fields.");
        Object.entries(error.errors).forEach(([field, messages]) => {
          form.setError(field as keyof SupplierFormValues, {
            type: "server",
            message: messages[0],
          });
        });
        return;
      }

      setDialogError(error.error ?? "Failed to create supplier.");
    },
  });
  const handleInvalidSubmit = (errors: typeof form.formState.errors) => {
    setDialogError(
      getFirstFormErrorMessage(errors) ?? "Fix the highlighted fields."
    );
  };

  return (
    <>
      <Field data-invalid={Boolean(errorMessage)}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <FieldLabel>Supplier</FieldLabel>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setDialogOpen(true)}
          >
            New Supplier
          </Button>
        </div>
        <Combobox
          items={supplierIds}
          value={value ?? null}
          onValueChange={(nextValue) => onValueChange(nextValue ?? null)}
          itemToStringLabel={(id) => supplierMap.get(id)?.name ?? ""}
        >
          <ComboboxInput placeholder="Search suppliers..." />
          <ComboboxContent className="bg-popover text-popover-foreground">
            <ComboboxEmpty>No suppliers found</ComboboxEmpty>
            <ComboboxList>
              {(id: string) => {
                const supplier = supplierMap.get(id);
                return (
                  <ComboboxItem key={id} value={id}>
                    <span>{supplier?.name ?? id}</span>
                    {supplier?.code && (
                      <span className="ml-auto text-xs text-muted-foreground">
                        {supplier.code}
                      </span>
                    )}
                  </ComboboxItem>
                );
              }}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
        {errorMessage && <FieldError>{errorMessage}</FieldError>}
      </Field>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) {
            form.reset(supplierDefaultValues);
            form.clearErrors();
            setDialogError(null);
          }
        }}
      >
        <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto bg-background text-foreground sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add Supplier</DialogTitle>
          </DialogHeader>

          {dialogError && <FieldError>{dialogError}</FieldError>}

          <form
            id="inline-supplier-form"
            className="space-y-0"
            onSubmit={form.handleSubmit(
              (values) => mutation.mutate(values),
              handleInvalidSubmit
            )}
          >
            <SupplierFieldGroups control={form.control} />
          </form>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="inline-supplier-form"
              disabled={mutation.isPending}
            >
              {mutation.isPending ? "Creating..." : "Create Supplier"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
