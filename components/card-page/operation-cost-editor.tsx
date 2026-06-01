"use client";

import { useCallback, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  CellClassParams,
  ICellRendererParams,
  ValueFormatterParams,
  ValueSetterParams,
} from "ag-grid-community";
import { apiJson } from "@/lib/client/api";
import { createClientId } from "@/lib/client-id";
import {
  buildIndexedFormErrorMap,
  formatPrice,
  getNestedFormErrorMessage,
  normalizeNullableTextValue,
} from "@/lib/format";
import { isPositiveNumberString } from "@/lib/schemas/shared";
import {
  MutableLines,
  type EditableLineDataGridChange,
  type LineField,
} from "@/components/editable-lines";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldError } from "@/components/ui/field";
import {
  CardNumberField,
  CardSelectField,
  CardTextField,
} from "@/components/card-page/card-field";

const CREATE_NEW_RESOURCE = "__create_new_resource__";

type ManufacturingResourceOption = {
  id: string;
  name: string;
  resourceType: string;
  loadedCostPerHour: string;
};

export type OperationCostPayloadRow = {
  operationName: string | null;
  resourceId: string | null;
  costScalingMode?: "per_output_unit" | "fixed_per_mo" | null;
  crewSize: string | null;
  plannedMinutes: string | null;
  loadedCostPerHour?: string | null;
};

type OperationCostGridRow = OperationCostPayloadRow & {
  clientRowId: string;
};

type OperationCostColumnKey =
  | "operationName"
  | "resourceId"
  | "costScalingMode"
  | "crewSize"
  | "plannedMinutes";

type OperationCostErrorState = {
  gridError: string | null;
  byRowId: Map<string, Map<OperationCostColumnKey, string>>;
};

type OperationCostEditorChangeMeta = {
  dirty: boolean;
  change: EditableLineDataGridChange<OperationCostGridRow>;
};

type ResourceFormState = {
  name: string;
  description: string;
  resourceType: ManufacturingResourceOption["resourceType"];
  loadedCostPerHour: string;
};

type ResourceFormErrors = Partial<Record<"name" | "loadedCostPerHour", string>>;

const OPERATION_COST_MODE_LABELS = {
  per_output_unit: "Per unit",
  fixed_per_mo: "Per MO",
} as const;

const blankOperationCostLine = {
  operationName: "",
  resourceId: "",
  costScalingMode: "per_output_unit" as const,
  crewSize: null,
  plannedMinutes: null,
  loadedCostPerHour: null,
};

const emptyResourceForm: ResourceFormState = {
  name: "",
  description: "",
  resourceType: "labor",
  loadedCostPerHour: "",
};

function formatOperationCost(params: {
  crewSize: string | null | undefined;
  plannedMinutes: string | null | undefined;
  loadedCostPerHour: string | null | undefined;
  costScalingMode: string | null | undefined;
  expectedBatchYield: string | null | undefined;
  typicalBatchSize: string | null | undefined;
  standardCostQuantity: string | null | undefined;
}) {
  const crewSize = Number(params.crewSize);
  const plannedMinutes = Number(params.plannedMinutes);
  const loadedCostPerHour = Number(params.loadedCostPerHour);
  if (
    !Number.isFinite(crewSize) ||
    !Number.isFinite(plannedMinutes) ||
    !Number.isFinite(loadedCostPerHour) ||
    crewSize <= 0 ||
    plannedMinutes <= 0
  ) {
    return "-";
  }

  const total = (crewSize * plannedMinutes * loadedCostPerHour) / 60;
  if (params.costScalingMode === "fixed_per_mo") {
    const costQuantity =
      params.expectedBatchYield ?? params.typicalBatchSize ?? params.standardCostQuantity;
    const quantity = Number(costQuantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return `${formatPrice(total.toFixed(2)) ?? "$0"} per MO`;
    }
    return `${formatPrice((total / quantity).toFixed(2)) ?? "$0"} / unit`;
  }

  return `${formatPrice(total.toFixed(2)) ?? "$0"} / unit`;
}

function createOperationCostRowId() {
  return createClientId("operation-cost-row");
}

const normalizeTextCell = normalizeNullableTextValue;

function createBlankOperationCostGridRow(): OperationCostGridRow {
  return {
    ...blankOperationCostLine,
    clientRowId: createOperationCostRowId(),
  };
}

function toOperationCostGridRows(
  rows: OperationCostPayloadRow[] | undefined,
): OperationCostGridRow[] {
  const gridRows =
    rows?.map((row) => ({
      ...blankOperationCostLine,
      ...row,
      operationName: row.operationName ?? "",
      resourceId: row.resourceId ?? "",
      costScalingMode: row.costScalingMode ?? "per_output_unit",
      clientRowId: createOperationCostRowId(),
    })) ?? [];

  return gridRows.length > 0 ? gridRows : [createBlankOperationCostGridRow()];
}

function toOperationCostPayloadRows(
  rows: OperationCostGridRow[],
): OperationCostPayloadRow[] {
  return rows.map((row) => ({
    operationName: normalizeTextCell(row.operationName),
    resourceId: normalizeTextCell(row.resourceId),
    costScalingMode: row.costScalingMode ?? "per_output_unit",
    crewSize: normalizeTextCell(row.crewSize),
    plannedMinutes: normalizeTextCell(row.plannedMinutes),
    loadedCostPerHour: normalizeTextCell(row.loadedCostPerHour),
  }));
}

function isBlankOperationCostGridRow(row: OperationCostPayloadRow) {
  const operationName = row.operationName?.trim() ?? "";
  const resourceId = row.resourceId?.trim() ?? "";
  const crewSize = row.crewSize?.trim() ?? "";
  const plannedMinutes = row.plannedMinutes?.trim() ?? "";

  return operationName === "" && resourceId === "" && crewSize === "" && plannedMinutes === "";
}

function comparableOperationCosts(rows: OperationCostGridRow[]) {
  return JSON.stringify(
    toOperationCostPayloadRows(rows)
      .filter((row) => !isBlankOperationCostGridRow(row))
      .map((row) => ({
        operationName: row.operationName ?? "",
        resourceId: row.resourceId ?? "",
        costScalingMode: row.costScalingMode ?? "per_output_unit",
        crewSize: row.crewSize ?? null,
        plannedMinutes: row.plannedMinutes ?? null,
        loadedCostPerHour: row.loadedCostPerHour ?? null,
      })),
  );
}

function buildOperationCostErrorState(
  error: unknown,
  rows: OperationCostGridRow[],
): OperationCostErrorState {
  const topLevelMessage = getNestedFormErrorMessage(error);
  const byRowId = buildIndexedFormErrorMap(
    error,
    rows,
    [
      "operationName",
      "resourceId",
      "costScalingMode",
      "crewSize",
      "plannedMinutes",
    ],
    (row) => row.clientRowId,
  );

  return {
    gridError: topLevelMessage,
    byRowId,
  };
}

function hasOperationCostCellError(
  errorState: OperationCostErrorState,
  row: OperationCostGridRow | undefined,
  key: OperationCostColumnKey,
) {
  if (!row) return false;
  return errorState.byRowId.get(row.clientRowId)?.has(key) ?? false;
}

function validatePositiveCell(value: unknown, message: string) {
  const normalized = normalizeTextCell(value);
  return isPositiveNumberString(normalized ?? "") ? null : [message];
}

function ResourceCell({
  data,
  resourcesById,
}: ICellRendererParams<OperationCostGridRow> & {
  resourcesById: Map<string, ManufacturingResourceOption>;
}) {
  if (!data?.resourceId) {
    return <span className="text-muted-foreground">Select</span>;
  }

  return (
    <span className="block truncate">
      {resourcesById.get(data.resourceId)?.name ?? data.resourceId}
    </span>
  );
}

function OperationCostCell({
  data,
  resourcesById,
  expectedBatchYield,
  typicalBatchSize,
  standardCostQuantity,
}: ICellRendererParams<OperationCostGridRow> & {
  resourcesById: Map<string, ManufacturingResourceOption>;
  expectedBatchYield: string | null | undefined;
  typicalBatchSize: string | null | undefined;
  standardCostQuantity: string | null | undefined;
}) {
  const resource = data?.resourceId ? resourcesById.get(data.resourceId) : null;
  return (
    <span className="text-muted-foreground">
      {formatOperationCost({
        crewSize: data?.crewSize,
        plannedMinutes: data?.plannedMinutes,
        loadedCostPerHour: data?.loadedCostPerHour ?? resource?.loadedCostPerHour,
        costScalingMode: data?.costScalingMode,
        expectedBatchYield,
        typicalBatchSize,
        standardCostQuantity,
      })}
    </span>
  );
}

function CreateResourceDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (resource: ManufacturingResourceOption) => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<ResourceFormState>(emptyResourceForm);
  const [formErrors, setFormErrors] = useState<ResourceFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const saveMutation = useMutation({
    mutationFn: async (values: ResourceFormState) => {
      const nextErrors: ResourceFormErrors = {};
      const parsedRate = Number(values.loadedCostPerHour);

      if (values.name.trim() === "") nextErrors.name = "Name is required";
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
      const created = await apiJson<{ id: string }>("/api/manufacturing-resources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      return { id: created.id, ...payload };
    },
    onSuccess: async (resource) => {
      onCreated(resource);
      setForm(emptyResourceForm);
      setFormErrors({});
      setFormError(null);
      onOpenChange(false);
      await queryClient.invalidateQueries({ queryKey: ["manufacturing-resources"] });
    },
    onError: (error) => {
      setFormError(error instanceof Error ? error.message : "Failed to create resource.");
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Create resource</DialogTitle>
        </DialogHeader>
        <div className="grid gap-(--space-4)">
          <CardTextField
            id="resource-name"
            label="Name"
            value={form.name}
            controlStyle="dialog"
            onChange={(event) =>
              setForm((current) => ({ ...current, name: event.target.value }))
            }
            autoFocus
            error={formErrors.name}
            invalid={Boolean(formErrors.name)}
          />
          <CardSelectField
            label="Type"
            value={form.resourceType}
            controlStyle="dialog"
            onValueChange={(value) =>
              setForm((current) => ({ ...current, resourceType: value }))
            }
            options={[
              { value: "labor", label: "Labor" },
              { value: "machine", label: "Machine" },
              { value: "overhead", label: "Overhead" },
            ]}
          />
          <CardNumberField
            id="resource-rate"
            label="Loaded cost per hour"
            value={form.loadedCostPerHour}
            controlStyle="dialog"
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                loadedCostPerHour: event.target.value,
              }))
            }
            error={formErrors.loadedCostPerHour}
            invalid={Boolean(formErrors.loadedCostPerHour)}
          />
          {formError ? <FieldError>{formError}</FieldError> : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => saveMutation.mutate(form)}
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? "Creating..." : "Create resource"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function OperationCostEditor({
  initialRows,
  resources,
  expectedBatchYield,
  typicalBatchSize,
  standardCostQuantity,
  error,
  onRowsChange,
}: {
  initialRows?: OperationCostPayloadRow[];
  resources: ManufacturingResourceOption[];
  expectedBatchYield: string | null | undefined;
  typicalBatchSize: string | null | undefined;
  standardCostQuantity: string | null | undefined;
  error?: unknown;
  onRowsChange?: (
    rows: OperationCostPayloadRow[],
    meta: OperationCostEditorChangeMeta,
  ) => void;
}) {
  const [initialGridRows] = useState(() => toOperationCostGridRows(initialRows));
  const [initialComparable] = useState(() =>
    comparableOperationCosts(toOperationCostGridRows(initialRows)),
  );
  const [rows, setRows] = useState<OperationCostGridRow[]>(initialGridRows);
  const [localResources, setLocalResources] = useState(resources);
  const [resourceDialogOpen, setResourceDialogOpen] = useState(false);
  const [pendingResourceRowId, setPendingResourceRowId] = useState<string | null>(null);
  const resourcesById = useMemo(
    () => new Map(localResources.map((resource) => [resource.id, resource])),
    [localResources],
  );
  const errorState = useMemo(
    () => buildOperationCostErrorState(error, rows),
    [error, rows],
  );

  const emitRowsChange = useCallback(
    (
      nextRows: OperationCostGridRow[],
      change: EditableLineDataGridChange<OperationCostGridRow>,
    ) => {
      setRows(nextRows);
      onRowsChange?.(toOperationCostPayloadRows(nextRows), {
        dirty: comparableOperationCosts(nextRows) !== initialComparable,
        change,
      });
    },
    [initialComparable, onRowsChange],
  );

  const getRowId = useCallback((row: OperationCostGridRow) => row.clientRowId, []);
  const isBlankRow = useCallback(
    (row: OperationCostGridRow) => isBlankOperationCostGridRow(row),
    [],
  );
  const rowHasError = useCallback(
    (row: OperationCostGridRow) => errorState.byRowId.has(row.clientRowId),
    [errorState],
  );
  const hasError = useCallback(
    (key: OperationCostColumnKey) => (params: CellClassParams<OperationCostGridRow>) =>
      hasOperationCostCellError(errorState, params.data, key),
    [errorState],
  );
  const errorTooltip = useCallback(
    (key: OperationCostColumnKey) => ({ data }: { data?: OperationCostGridRow }) =>
      data ? (errorState.byRowId.get(data.clientRowId)?.get(key) ?? null) : null,
    [errorState],
  );

  const handleResourceCreated = useCallback(
    (resource: ManufacturingResourceOption) => {
      setLocalResources((current) => [...current, resource]);

      if (!pendingResourceRowId) return;

      const previousRow = rows.find((row) => row.clientRowId === pendingResourceRowId);
      const wasBlank = previousRow ? isBlankOperationCostGridRow(previousRow) : false;
      let nextRows = rows.map((row) =>
        row.clientRowId === pendingResourceRowId
          ? {
              ...row,
              resourceId: resource.id,
              loadedCostPerHour: resource.loadedCostPerHour,
            }
          : row,
      );
      const updatedRow = nextRows.find((row) => row.clientRowId === pendingResourceRowId);
      let changeType: EditableLineDataGridChange<OperationCostGridRow>["type"] =
        "cell_edit_committed";

      if (
        wasBlank &&
        updatedRow &&
        nextRows.every((row) => !isBlankOperationCostGridRow(row))
      ) {
        nextRows = [...nextRows, createBlankOperationCostGridRow()];
        changeType = "blank_row_committed";
      }

      setPendingResourceRowId(null);
      emitRowsChange(nextRows, {
        type: changeType,
        row: updatedRow,
        rows: nextRows,
      });
    },
    [emitRowsChange, pendingResourceRowId, rows],
  );

  const columns = useMemo<LineField<OperationCostGridRow>[]>(
    () => [
      {
        field: "operationName",
        kind: "text",
        headerName: "Operation",
        minWidth: 180,
        flex: 1.2,
        editable: true,
        valueSetter: (params: ValueSetterParams<OperationCostGridRow, string | null>) => {
          params.data.operationName = normalizeTextCell(params.newValue) ?? "";
          return true;
        },
        getValidationErrors: (value, row) => {
          const nextRow = {
            ...row,
            operationName: normalizeTextCell(value) ?? "",
          };
          if (isBlankOperationCostGridRow(nextRow)) return null;
          return nextRow.operationName ? null : ["Name is required"];
        },
        cellClassRules: {
          "erp-editable-grid-cell-error": hasError("operationName"),
        },
        tooltipValueGetter: errorTooltip("operationName"),
      },
      {
        field: "resourceId",
        kind: "select",
        headerName: "Resource",
        minWidth: 172,
        flex: 1,
        editable: true,
        values: [
          "",
          ...localResources.map((resource) => resource.id),
          CREATE_NEW_RESOURCE,
        ],
        getValidationErrors: (value, row) => {
          const nextRow = {
            ...row,
            resourceId:
              value === CREATE_NEW_RESOURCE ? "" : normalizeTextCell(value) ?? "",
          };
          if (isBlankOperationCostGridRow(nextRow)) return null;
          return nextRow.resourceId ? null : ["Resource is required"];
        },
        valueFormatter: ({ value }) => {
          if (value === CREATE_NEW_RESOURCE) return "+ Create resource";
          return value ? (resourcesById.get(value)?.name ?? value) : "";
        },
        valueSetter: (params: ValueSetterParams<OperationCostGridRow, string | null>) => {
          if (params.newValue === CREATE_NEW_RESOURCE) {
            setPendingResourceRowId(params.data.clientRowId);
            setResourceDialogOpen(true);
            return false;
          }

          const resourceId = normalizeTextCell(params.newValue) ?? "";
          params.data.resourceId = resourceId;
          params.data.loadedCostPerHour =
            resourcesById.get(resourceId)?.loadedCostPerHour ?? null;
          return true;
        },
        cellRenderer: (params: ICellRendererParams<OperationCostGridRow>) => (
          <ResourceCell {...params} resourcesById={resourcesById} />
        ),
        cellClassRules: {
          "erp-editable-grid-cell-error": hasError("resourceId"),
        },
        tooltipValueGetter: errorTooltip("resourceId"),
      },
      {
        field: "costScalingMode",
        kind: "select",
        headerName: "Mode",
        minWidth: 116,
        flex: 0.7,
        editable: true,
        values: ["per_output_unit", "fixed_per_mo"],
        valueFormatter: ({
          value,
        }: ValueFormatterParams<
          OperationCostGridRow,
          OperationCostGridRow["costScalingMode"]
        >) => OPERATION_COST_MODE_LABELS[value ?? "per_output_unit"],
        cellClassRules: {
          "erp-editable-grid-cell-error": hasError("costScalingMode"),
        },
        tooltipValueGetter: errorTooltip("costScalingMode"),
      },
      {
        field: "crewSize",
        kind: "number",
        headerName: "Crew",
        minWidth: 108,
        flex: 0.6,
        editable: true,
        valueSetter: (params: ValueSetterParams<OperationCostGridRow, string | null>) => {
          params.data.crewSize = normalizeTextCell(params.newValue);
          return true;
        },
        getValidationErrors: (value) =>
          validatePositiveCell(value, "Crew size must be greater than 0"),
        rightAligned: true,
        cellClassRules: {
          "erp-editable-grid-cell-error": hasError("crewSize"),
        },
        tooltipValueGetter: errorTooltip("crewSize"),
      },
      {
        field: "plannedMinutes",
        kind: "number",
        headerName: "Minutes",
        minWidth: 128,
        flex: 0.7,
        editable: true,
        valueSetter: (params: ValueSetterParams<OperationCostGridRow, string | null>) => {
          params.data.plannedMinutes = normalizeTextCell(params.newValue);
          return true;
        },
        getValidationErrors: (value) =>
          validatePositiveCell(value, "Minutes must be greater than 0"),
        rightAligned: true,
        cellClassRules: {
          "erp-editable-grid-cell-error": hasError("plannedMinutes"),
        },
        tooltipValueGetter: errorTooltip("plannedMinutes"),
      },
      {
        colId: "cost",
        kind: "display",
        headerName: "Cost",
        minWidth: 136,
        flex: 0.8,
        cellRenderer: (params: ICellRendererParams<OperationCostGridRow>) => (
          <OperationCostCell
            {...params}
            resourcesById={resourcesById}
            expectedBatchYield={expectedBatchYield}
            typicalBatchSize={typicalBatchSize}
            standardCostQuantity={standardCostQuantity}
          />
        ),
      },
    ],
    [
      errorTooltip,
      expectedBatchYield,
      hasError,
      localResources,
      resourcesById,
      standardCostQuantity,
      typicalBatchSize,
    ],
  );

  return (
    <>
      <MutableLines
        rows={rows}
        fields={columns}
        getRowId={getRowId}
        createRow={createBlankOperationCostGridRow}
        onRowsChange={emitRowsChange}
        addLabel="Add operation cost"
        emptyMessage="No operation costs yet."
        isBlankRow={isBlankRow}
        rowHasError={rowHasError}
        error={errorState.gridError}
        defaultColDef={{
          cellClass: ({ data }) =>
            data && isBlankOperationCostGridRow(data) ? "muted" : undefined,
        }}
      />
      <CreateResourceDialog
        open={resourceDialogOpen}
        onOpenChange={(open) => {
          setResourceDialogOpen(open);
          if (!open) setPendingResourceRowId(null);
        }}
        onCreated={handleResourceCreated}
      />
    </>
  );
}
