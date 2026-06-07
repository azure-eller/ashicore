"use client";

import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ICellRendererParams } from "ag-grid-community";
import { Add01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { apiJson } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CreatePageShell } from "@/components/create-page";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { ERPDataGridList } from "@/components/erp-data-grid-list";
import type { ColDef } from "@/components/erp-data-grid";
import { formatPrice } from "@/lib/format";

type ResourceRow = {
  id: string;
  name: string;
  description: string | null;
  resourceType: "labor" | "machine" | "overhead" | "other";
  loadedCostPerHour: string;
};

type FormState = {
  id: string | null;
  name: string;
  description: string;
  resourceType: ResourceRow["resourceType"];
  loadedCostPerHour: string;
};

type FormErrors = Partial<Record<"name" | "loadedCostPerHour", string>>;

const emptyForm: FormState = {
  id: null,
  name: "",
  description: "",
  resourceType: "labor",
  loadedCostPerHour: "",
};

export function ManufacturingResourcesClient({
  initialResources,
}: {
  initialResources: ResourceRow[];
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(emptyForm);
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const saveMutation = useMutation({
    mutationFn: async (values: FormState) => {
      const nextErrors: FormErrors = {};
      const parsedRate = Number(values.loadedCostPerHour);

      if (values.name.trim() === "") {
        nextErrors.name = "Name is required";
      }

      if (
        values.loadedCostPerHour.trim() === "" ||
        !Number.isFinite(parsedRate) ||
        parsedRate < 0
      ) {
        nextErrors.loadedCostPerHour =
          "Loaded cost per hour must be a non-negative number";
      }

      if (Object.keys(nextErrors).length > 0) {
        setFormErrors(nextErrors);
        throw new Error("Fix the highlighted fields.");
      }

      setFormErrors({});
      setFormError(null);

      const payload = {
        name: values.name.trim(),
        description: values.description.trim() || null,
        resourceType: values.resourceType,
        loadedCostPerHour: values.loadedCostPerHour.trim(),
      };
      return apiJson<{ id: string }>(
        values.id
          ? `/api/manufacturing-resources/${values.id}`
          : "/api/manufacturing-resources",
        {
          method: values.id ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
    },
    onSuccess: async () => {
      setForm(emptyForm);
      setFormErrors({});
      setFormError(null);
      setDialogOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["manufacturing-resources"] });
    },
    onError: (error) => {
      setFormError(error instanceof Error ? error.message : "Resource save failed.");
    },
  });
  const columns = useMemo<ColDef<ResourceRow>[]>(
    () => [
      {
        field: "name",
        headerName: "Name",
        minWidth: 190,
        flex: 1.1,
      },
      {
        field: "resourceType",
        headerName: "Type",
        width: 140,
        valueFormatter: ({ value }) =>
          typeof value === "string"
            ? value.charAt(0).toUpperCase() + value.slice(1)
            : "—",
      },
      {
        field: "loadedCostPerHour",
        headerName: "Loaded Rate / Hour",
        width: 150,
        valueFormatter: ({ value }) => formatPrice(value) ?? value ?? "—",
      },
      {
        field: "description",
        headerName: "Description",
        minWidth: 220,
        flex: 1,
        valueFormatter: ({ value }) => value ?? "—",
      },
      {
        colId: "actions",
        headerName: "",
        width: 110,
        sortable: false,
        filter: false,
        cellRenderer: ({ data }: ICellRendererParams<ResourceRow>) =>
          data ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setForm({
                  id: data.id,
                  name: data.name,
                  description: data.description ?? "",
                  resourceType: data.resourceType,
                  loadedCostPerHour: data.loadedCostPerHour,
                });
                setFormErrors({});
                setFormError(null);
                setDialogOpen(true);
              }}
            >
              Edit
            </Button>
          ) : null,
      },
    ],
    []
  );

  const openCreateDialog = () => {
    setForm(emptyForm);
    setFormErrors({});
    setFormError(null);
    setDialogOpen(true);
  };

  return (
    <CreatePageShell>
      <ERPDataGridList
        rows={initialResources}
        columns={columns}
        queryKey={["manufacturing-resources"]}
        queryFn={() => apiJson<ResourceRow[]>("/api/manufacturing-resources")}
        searchAriaLabel="Search manufacturing resources"
        emptyMessage="No resources yet."
        actions={
          <Button type="button" onClick={openCreateDialog}>
            <HugeiconsIcon icon={Add01Icon} data-icon="inline-start" />
            New Resource
          </Button>
        }
        deleteAction={{
          endpoint: "/api/manufacturing-resources",
          invalidateQueryKeys: [["manufacturing-resources"]],
          defaultErrorMessage: "Failed to delete resource.",
          confirmTitle: (count) =>
            `Delete ${count} resource${count === 1 ? "" : "s"}?`,
          confirmDescription: (count) =>
            `The selected resource${count === 1 ? "" : "s"} will be archived. BOM operation cost lines using ${count === 1 ? "it" : "them"} will be removed, and manufacturing order snapshots will keep their copied cost details without a resource link.`,
        }}
      />
      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) {
            setForm(emptyForm);
            setFormErrors({});
            setFormError(null);
          }
        }}
      >
        <DialogContent size="3xl">
          <DialogHeader>
            <DialogTitle>{form.id ? "Edit Resource" : "New Resource"}</DialogTitle>
          </DialogHeader>
          <form
            className="flex flex-col gap-(--space-5)"
            onSubmit={(event) => {
              event.preventDefault();
              saveMutation.mutate(form);
            }}
          >
            <FieldGroup>
              <div className="grid gap-(--space-4) md:grid-cols-4">
                <Field data-invalid={Boolean(formErrors.name)}>
                  <FieldLabel htmlFor="resource-name">Name</FieldLabel>
                  <Input
                    id="resource-name"
                    value={form.name}
                    aria-invalid={Boolean(formErrors.name)}
                    onChange={(event) => {
                      setForm((prev) => ({ ...prev, name: event.target.value }));
                      setFormErrors((prev) => ({ ...prev, name: undefined }));
                    }}
                  />
                  {formErrors.name ? <FieldError>{formErrors.name}</FieldError> : null}
                </Field>
                <Field>
                  <FieldLabel>Type</FieldLabel>
                  <Select
                    value={form.resourceType}
                    onValueChange={(value) =>
                      setForm((prev) => ({
                        ...prev,
                        resourceType: value as ResourceRow["resourceType"],
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="labor">Labor</SelectItem>
                      <SelectItem value="machine">Machine</SelectItem>
                      <SelectItem value="overhead">Overhead</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field data-invalid={Boolean(formErrors.loadedCostPerHour)}>
                  <FieldLabel htmlFor="resource-rate">Loaded rate / hour</FieldLabel>
                  <Input
                    id="resource-rate"
                    value={form.loadedCostPerHour}
                    aria-invalid={Boolean(formErrors.loadedCostPerHour)}
                    inputMode="decimal"
                    onChange={(event) => {
                      setForm((prev) => ({
                        ...prev,
                        loadedCostPerHour: event.target.value,
                      }));
                      setFormErrors((prev) => ({
                        ...prev,
                        loadedCostPerHour: undefined,
                      }));
                    }}
                  />
                  {formErrors.loadedCostPerHour ? (
                    <FieldError>{formErrors.loadedCostPerHour}</FieldError>
                  ) : null}
                </Field>
                <Field>
                  <FieldLabel htmlFor="resource-description">Description</FieldLabel>
                  <Input
                    id="resource-description"
                    value={form.description}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, description: event.target.value }))
                    }
                  />
                </Field>
              </div>
            </FieldGroup>
            {formError ? <FieldError>{formError}</FieldError> : null}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
                disabled={saveMutation.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={saveMutation.isPending}>
                {saveMutation.isPending ? "Saving..." : "Save Resource"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </CreatePageShell>
  );
}
