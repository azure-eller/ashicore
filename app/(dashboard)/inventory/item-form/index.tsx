"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSmartBack } from "@/lib/hooks/use-smart-back";
import { apiJson } from "@/lib/client/api";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  CellClassParams,
  ICellEditorParams,
  ICellRendererParams,
  ValueFormatterParams,
  ValueSetterParams,
} from "ag-grid-community";
import { HugeiconsIcon } from "@hugeicons/react";
import { CircleLock01Icon, CircleUnlock01Icon } from "@hugeicons/core-free-icons";
import { formatPrice, getFirstFormErrorMessage, parsePositive } from "@/lib/format";
import { resolveStockUnitCostFromDefaultPurchasePrice } from "@/lib/inventory/cost";
import {
  insertItemSchema,
  insertMasterItemSchema,
  updateItemSchema,
  type InsertItemFormValues,
  type InsertMasterItemFormValues,
  type UpdateItemFormValues,
} from "@/lib/schemas/items";
import { ITEM_TYPE_SEGMENTS } from "@/app/(dashboard)/inventory/types";
import type { getItem } from "@/app/(dashboard)/inventory/queries";
import { getUomOptions } from "@/lib/units-of-measure";
import { derivePurchaseToStockFactor } from "@/lib/units-of-measure";
import { Button } from "@/components/ui/button";
import {
  CreatePageGrid,
  CreatePageHeader,
  CreatePageShell,
  CreateSection,
  CreateSidebarCard,
  SummaryRows,
} from "@/components/create-page";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
} from "@/components/ui/field";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TooltipHeader } from "@/components/tooltip-header";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import {
  EditableLineDataGrid,
  type ColDef,
  type EditableLineDataGridChange,
} from "@/components/editable-line-data-grid";
import { BomEditor, type BomPayloadRow } from "@/app/(dashboard)/inventory/bom-editor";
import { BomLockConfirmDialog } from "./dialogs/bom-lock-confirm-dialog";
import { CreateUnitDialog } from "./dialogs/create-unit-dialog";
import { CurrentStockCostDialog } from "./dialogs/current-stock-cost-dialog";
import { AxesInput } from "./fields/axes-input";
import {
  CURRENT_STOCK_UNIT_COST_TOOLTIP,
  ITEM_CATEGORY_TOOLTIP,
  ITEM_SKU_TOOLTIP,
  ON_HAND_STOCK_TOOLTIP,
  PURCHASE_CONVERSION_TOOLTIP,
  PURCHASE_PRICE_TOOLTIP,
  PURCHASE_UNIT_TOOLTIP,
  SAFETY_STOCK_TOOLTIP,
  SELLING_PRICE_TOOLTIP,
  STOCKING_UNIT_TOOLTIP,
} from "@/lib/tooltip-copy";

const CREATE_NEW_UNIT = "__create_new__";
const CREATE_NEW_RESOURCE = "__create_new_resource__";
const POSITIVE_NUMBER_RE = /^\d+\.?\d*$/;
const uomGroups = getUomOptions();

type AvailableComponent = {
  id: string;
  name: string;
  displayName: string;
  itemType: string;
  unit: string;
};

interface ItemFormProps {
  itemType: "material" | "product";
  units: { id: string; name: string; size: string; uom: string }[];
  categories: string[];
  availableComponents?: AvailableComponent[];
  manufacturingResources?: Array<{
    id: string;
    name: string;
    resourceType: string;
    loadedCostPerHour: string;
  }>;
  canManageBomLock?: boolean;
  initialData?: NonNullable<Awaited<ReturnType<typeof getItem>>> & {
    bom?: BomPayloadRow[];
    operationCosts?: OperationCostPayloadRow[];
  };
}

type ItemFormValues = InsertItemFormValues | UpdateItemFormValues | InsertMasterItemFormValues;
type ItemMutationResult = { id: string };
type CurrentStockUnitCostResult = { id: string; currentStockUnitCost: string | null };
type UnitDefinitionResult = { id: string; name: string; size: string; uom: string };

type ManufacturingResourceOption = NonNullable<ItemFormProps["manufacturingResources"]>[number];

type ResourceFormState = {
  name: string;
  description: string;
  resourceType: ManufacturingResourceOption["resourceType"];
  loadedCostPerHour: string;
};

type ResourceFormErrors = Partial<Record<"name" | "loadedCostPerHour", string>>;

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
    return "—";
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

type OperationCostPayloadRow = {
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

function createOperationCostRowId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `operation-cost-row-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function normalizeTextCell(value: unknown) {
  if (value == null) {
    return null;
  }

  const nextValue = String(value).trim();
  return nextValue === "" ? null : nextValue;
}

function getNestedMessage(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as { message?: unknown; root?: unknown };
  if (typeof candidate.message === "string") {
    return candidate.message;
  }

  return getNestedMessage(candidate.root);
}

function createBlankOperationCostGridRow(): OperationCostGridRow {
  return {
    ...blankOperationCostLine,
    clientRowId: createOperationCostRowId(),
  };
}

function toOperationCostGridRows(
  rows: OperationCostPayloadRow[] | undefined
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
  rows: OperationCostGridRow[]
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
      }))
  );
}

function buildOperationCostErrorState(
  error: unknown,
  rows: OperationCostGridRow[]
): OperationCostErrorState {
  const byRowId = new Map<string, Map<OperationCostColumnKey, string>>();
  const topLevelMessage = getNestedMessage(error);
  const rowErrors = Array.isArray(error) ? error : [];

  rowErrors.forEach((rowError, index) => {
    const row = rows[index];
    if (!row || !rowError || typeof rowError !== "object") {
      return;
    }

    const rowErrorObject = rowError as Record<string, unknown>;
    const rowMessages = new Map<OperationCostColumnKey, string>();
    const keys: OperationCostColumnKey[] = [
      "operationName",
      "resourceId",
      "costScalingMode",
      "crewSize",
      "plannedMinutes",
    ];

    keys.forEach((key) => {
      const message = getNestedMessage(rowErrorObject[key]);
      if (message) {
        rowMessages.set(key, message);
      }
    });

    if (rowMessages.size > 0) {
      byRowId.set(row.clientRowId, rowMessages);
    }
  });

  return {
    gridError: topLevelMessage,
    byRowId,
  };
}

function hasOperationCostCellError(
  errorState: OperationCostErrorState,
  row: OperationCostGridRow | undefined,
  key: OperationCostColumnKey
) {
  if (!row) {
    return false;
  }

  return errorState.byRowId.get(row.clientRowId)?.has(key) ?? false;
}

function validatePositiveCell(value: unknown, message: string) {
  const normalized = normalizeTextCell(value);
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? null : [message];
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

function OperationCostEditor({
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
    meta: OperationCostEditorChangeMeta
  ) => void;
}) {
  const [initialGridRows] = useState(() => toOperationCostGridRows(initialRows));
  const [initialComparable] = useState(() =>
    comparableOperationCosts(toOperationCostGridRows(initialRows))
  );
  const [rows, setRows] = useState<OperationCostGridRow[]>(initialGridRows);
  const [localResources, setLocalResources] = useState(resources);
  const [resourceDialogOpen, setResourceDialogOpen] = useState(false);
  const [pendingResourceRowId, setPendingResourceRowId] = useState<string | null>(null);
  const resourcesById = useMemo(
    () => new Map(localResources.map((resource) => [resource.id, resource])),
    [localResources]
  );
  const errorState = useMemo(
    () => buildOperationCostErrorState(error, rows),
    [error, rows]
  );

  const emitRowsChange = useCallback(
    (
      nextRows: OperationCostGridRow[],
      change: EditableLineDataGridChange<OperationCostGridRow>
    ) => {
      setRows(nextRows);
      onRowsChange?.(toOperationCostPayloadRows(nextRows), {
        dirty: comparableOperationCosts(nextRows) !== initialComparable,
        change,
      });
    },
    [initialComparable, onRowsChange]
  );

  const getRowId = useCallback((row: OperationCostGridRow) => row.clientRowId, []);
  const isBlankRow = useCallback(
    (row: OperationCostGridRow) => isBlankOperationCostGridRow(row),
    []
  );
  const rowHasError = useCallback(
    (row: OperationCostGridRow) => errorState.byRowId.has(row.clientRowId),
    [errorState]
  );
  const hasError = useCallback(
    (key: OperationCostColumnKey) => (params: CellClassParams<OperationCostGridRow>) =>
      hasOperationCostCellError(errorState, params.data, key),
    [errorState]
  );
  const errorTooltip = useCallback(
    (key: OperationCostColumnKey) => ({ data }: { data?: OperationCostGridRow }) =>
      data ? (errorState.byRowId.get(data.clientRowId)?.get(key) ?? null) : null,
    [errorState]
  );

  const handleResourceCreated = useCallback(
    (resource: ManufacturingResourceOption) => {
      setLocalResources((current) => [...current, resource]);

      if (!pendingResourceRowId) {
        return;
      }

      const previousRow = rows.find((row) => row.clientRowId === pendingResourceRowId);
      const wasBlank = previousRow ? isBlankOperationCostGridRow(previousRow) : false;
      let nextRows = rows.map((row) =>
        row.clientRowId === pendingResourceRowId
          ? {
              ...row,
              resourceId: resource.id,
              loadedCostPerHour: resource.loadedCostPerHour,
            }
          : row
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
    [emitRowsChange, pendingResourceRowId, rows]
  );

  const columns = useMemo<ColDef<OperationCostGridRow>[]>(
    () => [
      {
        field: "operationName",
        headerName: "Operation",
        minWidth: 180,
        flex: 1.2,
        editable: true,
        cellEditor: "agTextCellEditor",
        valueSetter: (params: ValueSetterParams<OperationCostGridRow, string | null>) => {
          params.data.operationName = normalizeTextCell(params.newValue) ?? "";
          return true;
        },
        cellEditorParams: {
          getValidationErrors: ({
            value,
            cellEditorParams,
          }: {
            value: string | null | undefined;
            cellEditorParams: ICellEditorParams<OperationCostGridRow>;
          }) => {
            const row = {
              ...cellEditorParams.data,
              operationName: normalizeTextCell(value) ?? "",
            };
            if (isBlankOperationCostGridRow(row)) {
              return null;
            }

            return row.operationName ? null : ["Name is required"];
          },
        },
        cellClassRules: {
          "erp-editable-grid-cell-error": hasError("operationName"),
        },
        tooltipValueGetter: errorTooltip("operationName"),
      },
      {
        field: "resourceId",
        headerName: "Resource",
        minWidth: 172,
        flex: 1,
        editable: true,
        cellEditor: "agSelectCellEditor",
        cellEditorParams: {
          values: [
            ...localResources.map((resource) => resource.id),
            CREATE_NEW_RESOURCE,
          ],
          openEditorOnStart: true,
          getValidationErrors: ({
            value,
            cellEditorParams,
          }: {
            value: string | null | undefined;
            cellEditorParams: ICellEditorParams<OperationCostGridRow>;
          }) => {
            const row = {
              ...cellEditorParams.data,
              resourceId:
                value === CREATE_NEW_RESOURCE ? "" : normalizeTextCell(value) ?? "",
            };
            if (isBlankOperationCostGridRow(row)) {
              return null;
            }

            return row.resourceId ? null : ["Resource is required"];
          },
        },
        valueFormatter: ({ value }) => {
          if (value === CREATE_NEW_RESOURCE) {
            return "+ Create resource";
          }
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
        headerName: "Mode",
        minWidth: 116,
        flex: 0.7,
        editable: true,
        cellEditor: "agSelectCellEditor",
        cellEditorParams: {
          values: ["per_output_unit", "fixed_per_mo"],
        },
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
        headerName: "Crew",
        minWidth: 108,
        flex: 0.6,
        editable: true,
        cellEditor: "agTextCellEditor",
        valueSetter: (params: ValueSetterParams<OperationCostGridRow, string | null>) => {
          params.data.crewSize = normalizeTextCell(params.newValue);
          return true;
        },
        cellEditorParams: {
          getValidationErrors: ({ value }: { value: string | null | undefined }) =>
            validatePositiveCell(value, "Crew size must be greater than 0"),
        },
        cellClass: "num",
        cellClassRules: {
          "erp-editable-grid-cell-error": hasError("crewSize"),
        },
        tooltipValueGetter: errorTooltip("crewSize"),
      },
      {
        field: "plannedMinutes",
        headerName: "Minutes",
        minWidth: 128,
        flex: 0.7,
        editable: true,
        cellEditor: "agTextCellEditor",
        valueSetter: (params: ValueSetterParams<OperationCostGridRow, string | null>) => {
          params.data.plannedMinutes = normalizeTextCell(params.newValue);
          return true;
        },
        cellEditorParams: {
          getValidationErrors: ({ value }: { value: string | null | undefined }) =>
            validatePositiveCell(value, "Minutes must be greater than 0"),
        },
        cellClass: "num",
        cellClassRules: {
          "erp-editable-grid-cell-error": hasError("plannedMinutes"),
        },
        tooltipValueGetter: errorTooltip("plannedMinutes"),
      },
      {
        colId: "cost",
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
    ]
  );

  return (
    <>
      <EditableLineDataGrid
        rows={rows}
        columns={columns}
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
          if (!open) {
            setPendingResourceRowId(null);
          }
        }}
        onCreated={handleResourceCreated}
      />
    </>
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
      setFormError(error instanceof Error ? error.message : "Resource save failed.");
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen);
        if (!nextOpen) {
          setForm(emptyResourceForm);
          setFormErrors({});
          setFormError(null);
        }
      }}
    >
      <DialogContent size="3xl">
        <DialogHeader>
          <DialogTitle>New Resource</DialogTitle>
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
                      resourceType: value as ManufacturingResourceOption["resourceType"],
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
              onClick={() => onOpenChange(false)}
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
  );
}

export function ItemForm({
  itemType,
  units,
  categories,
  availableComponents,
  manufacturingResources = [],
  canManageBomLock = false,
  initialData,
}: ItemFormProps) {
  const queryClient = useQueryClient();
  const segment = ITEM_TYPE_SEGMENTS[itemType];
  const isEditing = Boolean(initialData);
  const isVariant = itemType === "product" && initialData?.parentId != null;
  const typeLabel = itemType === "product" ? "Product" : "Material";
  const fallbackPath = `/inventory/${segment}${initialData ? `/${initialData.id}` : ""}`;
  const [isMaster, setIsMaster] = useState(initialData?.isMaster ?? false);
  const variantFamilyName = isVariant ? (initialData?.parentName ?? initialData?.name ?? "") : "";
  const variantTitle = isVariant ? (initialData?.displayName ?? variantFamilyName) : "";
  const showMasterToggle = itemType === "product" && !isEditing && !initialData?.isMaster;
  const [categoryInput, setCategoryInput] = useState("");
  const [localUnits, setLocalUnits] = useState(units);
  const [isUnitDialogOpen, setIsUnitDialogOpen] = useState(false);
  const [bomLockConfirmOpen, setBomLockConfirmOpen] = useState(false);
  const [pendingBomLocked, setPendingBomLocked] = useState<boolean | null>(null);
  const [bomGridDirty, setBomGridDirty] = useState(false);
  const [operationCostGridDirty, setOperationCostGridDirty] = useState(false);
  const [currentStockUnitCostDialogOpen, setCurrentStockUnitCostDialogOpen] =
    useState(false);
  const [currentStockUnitCostDraft, setCurrentStockUnitCostDraft] = useState("");
  const [currentStockUnitCostError, setCurrentStockUnitCostError] = useState<string | null>(
    null
  );
  const [unitName, setUnitName] = useState("");
  const [unitSize, setUnitSize] = useState("");
  const [unitUom, setUnitUom] = useState("");
  const unitSizeInvalid = unitSize.trim() !== "" && !POSITIVE_NUMBER_RE.test(unitSize.trim());
  const resetUnitForm = () => {
    setUnitName("");
    setUnitSize("");
    setUnitUom("");
  };

  const categoriesSet = useMemo(
    () => new Set(categories.map((c) => c.toLowerCase())),
    [categories]
  );

  const categoryItems = useMemo(() => {
    const trimmed = categoryInput.trim();
    if (trimmed && !categoriesSet.has(trimmed.toLowerCase())) {
      return [...categories, trimmed];
    }
    return categories;
  }, [categoryInput, categories, categoriesSet]);

  const activeSchema = isMaster
    ? insertMasterItemSchema
    : initialData
      ? updateItemSchema
      : insertItemSchema;

  const form = useForm<ItemFormValues>({
    resolver: zodResolver(activeSchema),
    mode: "onBlur",
    defaultValues: initialData
      ? {
          name: initialData.name,
          purchaseUnitDefinitionId: initialData.purchaseUnitDefinitionId,
          purchaseToStockFactor: initialData.purchaseToStockFactor,
          sku: initialData.sku,
          category: initialData.category,
          description: initialData.description,
          defaultPurchasePrice: initialData.defaultPurchasePrice,
          currentStockUnitCost: initialData.currentStockUnitCost,
          defaultSellingPrice: initialData.defaultSellingPrice,
          sellable: initialData.sellable ?? true,
          manufacturingMode: "discrete" as const,
          expectedBatchYield: initialData.expectedBatchYield,
          typicalBatchSize: initialData.typicalBatchSize,
          typicalGroupSize: initialData.typicalGroupSize,
          standardCostQuantity: initialData.standardCostQuantity,
          bomLocked: initialData.bomLocked ?? false,
          stock: initialData.stock,
          safetyStock: initialData.safetyStock,
          bom: initialData.bom ?? [],
          operationCosts: initialData.operationCosts ?? [],
          revisionNote: null,
        }
      : isMaster
        ? {
            name: "",
            description: null,
            category: null,
            variantAxes: [],
          }
        : {
            name: "",
            itemType: itemType as "material" | "product",
            unitDefinitionId: "",
            purchaseUnitDefinitionId: null,
            purchaseToStockFactor: null,
            sku: null,
            category: null,
            description: null,
            defaultPurchasePrice: null,
            currentStockUnitCost: null,
            defaultSellingPrice: null,
            sellable: false,
            manufacturingMode: "discrete" as const,
            expectedBatchYield: null,
            typicalBatchSize: null,
            typicalGroupSize: null,
            standardCostQuantity: null,
            bomLocked: false,
            stock: "0",
            safetyStock: "0",
            bom: [],
            operationCosts: [],
            revisionNote: null,
          },
  });

  const [formError, setFormError] = useState<string | null>(null);
  const [unitError, setUnitError] = useState<string | null>(null);
  const bomLocked = useWatch({
    control: form.control,
    name: "bomLocked",
  });
  const watchedTypicalBatchSize = useWatch({
    control: form.control,
    name: "typicalBatchSize",
  });
  const watchedExpectedBatchYield = useWatch({
    control: form.control,
    name: "expectedBatchYield",
  });
  const watchedTypicalGroupSize = useWatch({
    control: form.control,
    name: "typicalGroupSize",
  });
  const watchedStandardCostQuantity = useWatch({
    control: form.control,
    name: "standardCostQuantity",
  });
  const selectedStockingUnitId = useWatch({
    control: form.control,
    name: "unitDefinitionId",
  });
  const selectedPurchaseUnitId = useWatch({
    control: form.control,
    name: "purchaseUnitDefinitionId",
  });
  const watchedDefaultPurchasePrice = useWatch({
    control: form.control,
    name: "defaultPurchasePrice",
  });
  const watchedPurchaseToStockFactor = useWatch({
    control: form.control,
    name: "purchaseToStockFactor",
  });
  const watchedCurrentStockUnitCost = useWatch({
    control: form.control,
    name: "currentStockUnitCost",
  });
  const watchedDefaultSellingPrice = useWatch({
    control: form.control,
    name: "defaultSellingPrice",
  });
  const watchedStock = useWatch({
    control: form.control,
    name: "stock",
  });
  const watchedSafetyStock = useWatch({
    control: form.control,
    name: "safetyStock",
  });

  const stockingUnit = useMemo(() => {
    const unitId = isEditing ? initialData?.unitDefinitionId : selectedStockingUnitId;
    return localUnits.find((unit) => unit.id === unitId) ?? null;
  }, [initialData?.unitDefinitionId, isEditing, localUnits, selectedStockingUnitId]);

  const purchaseUnit = useMemo(
    () => localUnits.find((unit) => unit.id === selectedPurchaseUnitId) ?? null,
    [localUnits, selectedPurchaseUnitId]
  );

  const derivedPurchaseFactor = useMemo(() => {
    if (!stockingUnit || !purchaseUnit) {
      return null;
    }

    return derivePurchaseToStockFactor(purchaseUnit, stockingUnit);
  }, [purchaseUnit, stockingUnit]);

  useEffect(() => {
    if (isMaster) return;

    if (!selectedPurchaseUnitId) {
      form.setValue("purchaseToStockFactor" as never, null as never, {
        shouldDirty: true,
        shouldValidate: true,
      });
      return;
    }

    if (derivedPurchaseFactor == null) {
      form.setValue("purchaseToStockFactor" as never, null as never, {
        shouldDirty: true,
        shouldValidate: true,
      });
      return;
    }

    form.setValue("purchaseToStockFactor" as never, derivedPurchaseFactor.toFixed(4).replace(/\.?0+$/, "") as never, {
      shouldDirty: true,
      shouldValidate: true,
    });
  }, [derivedPurchaseFactor, form, isMaster, selectedPurchaseUnitId]);

  const mutation = useMutation({
    mutationFn: async (data: ItemFormValues) => {
      const url = initialData ? `/api/items/${initialData.id}` : "/api/items";
      const method = initialData ? "PUT" : "POST";
      const nextData = isVariant ? { ...data, name: variantFamilyName } : data;
      const basePayload = isMaster ? { ...nextData, isMaster: true } : nextData;
      const payload =
        initialData && itemType === "material"
          ? (() => {
              const nextPayload = {
                ...basePayload,
              } as typeof basePayload & { currentStockUnitCost?: string | null };
              delete nextPayload.currentStockUnitCost;
              return nextPayload;
            })()
          : basePayload;
      const fallback = initialData
        ? `Failed to update ${typeLabel.toLowerCase()}.`
        : `Failed to create ${typeLabel.toLowerCase()}.`;
      return apiJson<ItemMutationResult>(url, {
        method,
        idempotencyKey: "item-form-save",
        body: payload,
        fallbackError: fallback,
      });
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["items"] });
      const nextPath = isEditing ? fallbackPath : `/inventory/${segment}/${result.id}`;
      window.setTimeout(() => {
        window.location.assign(nextPath);
      }, 250);
    },
    onError: (error) => {
      setFormError(error.message);
    },
    onMutate: () => {
      setFormError(null);
    },
  });
  const handleInvalidSubmit = (errors: typeof form.formState.errors) => {
    setFormError(
      getFirstFormErrorMessage(errors) ?? "Fix the highlighted fields."
    );
  };

  const currentStockUnitCostMutation = useMutation({
    mutationFn: async () => {
      if (!initialData) {
        throw new Error("Current stock unit cost can only be overridden after the item exists.");
      }

      return apiJson<CurrentStockUnitCostResult>(
        `/api/items/${initialData.id}/current-stock-unit-cost`,
        {
          method: "PUT",
          idempotencyKey: "item-current-stock-unit-cost",
          body: {
            currentStockUnitCost: currentStockUnitCostDraft,
          },
          fallbackError: "Failed to update current stock unit cost.",
          mapError: (_status, body) => {
            const payload = body as
              | {
                  error?: unknown;
                  errors?: { currentStockUnitCost?: string[] };
                }
              | null;
            const fieldMessage = payload?.errors?.currentStockUnitCost?.[0];
            const message =
              fieldMessage ??
              (typeof payload?.error === "string"
                ? payload.error
                : "Failed to update current stock unit cost.");
            return new Error(message);
          },
        }
      );
    },
    onSuccess: async (result) => {
      setCurrentStockUnitCostDraft(result.currentStockUnitCost ?? "");
      setCurrentStockUnitCostDialogOpen(false);
      setCurrentStockUnitCostError(null);
      form.setValue(
        "currentStockUnitCost" as never,
        (result.currentStockUnitCost ?? null) as never,
        {
          shouldDirty: false,
          shouldTouch: false,
          shouldValidate: false,
        }
      );
      await queryClient.invalidateQueries({ queryKey: ["items"] });
    },
    onError: (error) => {
      setCurrentStockUnitCostError(error.message);
    },
    onMutate: () => {
      setCurrentStockUnitCostError(null);
    },
  });

  const unitMutation = useMutation({
    mutationFn: async () => {
      return apiJson<UnitDefinitionResult>("/api/units", {
        method: "POST",
        body: { name: unitName, size: unitSize, uom: unitUom },
        fallbackError: "Failed to create unit.",
      });
    },
    onSuccess: (newUnit) => {
      setLocalUnits((prev) => [...prev, newUnit]);
      if (!isMaster) {
        form.setValue("unitDefinitionId" as never, newUnit.id as never);
      }
      setIsUnitDialogOpen(false);
      resetUnitForm();
      setUnitError(null);
    },
    onError: (error) => {
      setUnitError(error.message);
    },
    onMutate: () => {
      setUnitError(null);
    },
  });

  const handleBomRowsChange = useCallback(
    (rows: BomPayloadRow[], meta: { dirty: boolean }) => {
      setBomGridDirty(meta.dirty);
      form.setValue("bom" as never, rows as never, {
        shouldDirty: meta.dirty,
        shouldTouch: false,
        shouldValidate: false,
      });
    },
    [form]
  );

  const handleOperationCostRowsChange = useCallback(
    (rows: OperationCostPayloadRow[], meta: { dirty: boolean }) => {
      setOperationCostGridDirty(meta.dirty);
      form.setValue("operationCosts" as never, rows as never, {
        shouldDirty: meta.dirty,
        shouldTouch: false,
        shouldValidate: false,
      });
    },
    [form]
  );

  const submitLabel = isEditing
    ? (mutation.isPending ? "Saving..." : "Save Changes")
    : (mutation.isPending ? "Creating..." : isMaster ? "Create Variant Master" : `Create ${typeLabel}`);
  const isBomDirty =
    itemType === "product" &&
    !isMaster &&
    Boolean(
        (form.formState.dirtyFields as Record<string, unknown>).bom ||
        bomGridDirty ||
        (form.formState.dirtyFields as Record<string, unknown>).operationCosts ||
        operationCostGridDirty
    );
  const lockTarget = pendingBomLocked ?? bomLocked;
  const lockDialogTitle = lockTarget ? "Lock this BOM?" : "Unlock this BOM?";
  const lockDialogDescription = lockTarget
    ? "Only inventory admins will be able to view and edit this BOM once it is locked."
    : "Members with inventory view or operate access will be able to view and edit this BOM once it is unlocked.";

  const handleCancel = useSmartBack(fallbackPath);
  const currentStockUnitCost = parsePositive(
    (watchedCurrentStockUnitCost as string | null | undefined) ?? null
  );
  const defaultStockUnitCost = resolveStockUnitCostFromDefaultPurchasePrice({
    defaultPurchasePrice:
      (watchedDefaultPurchasePrice as string | null | undefined) ?? null,
    purchaseToStockFactor:
      (watchedPurchaseToStockFactor as string | null | undefined) ?? null,
  });
  const materialCost =
    currentStockUnitCost ??
    (defaultStockUnitCost != null ? Number.parseFloat(defaultStockUnitCost) : null);
  const sellingPrice =
    parsePositive((watchedDefaultSellingPrice as string | null | undefined) ?? null) ?? 0;
  const stockOnHand =
    parsePositive((watchedStock as string | null | undefined) ?? null) ?? 0;
  const safetyStock =
    parsePositive((watchedSafetyStock as string | null | undefined) ?? null) ?? 0;
  const marginPercent =
    sellingPrice > 0 && materialCost != null
      ? ((sellingPrice - materialCost) / sellingPrice) * 100
      : null;
  const unitProfit = materialCost != null ? Math.max(0, sellingPrice - materialCost) : null;
  const marginClass =
    marginPercent == null
      ? "text-muted-foreground"
      : marginPercent >= 30
        ? "text-success"
        : marginPercent >= 15
          ? "text-warning"
          : "text-destructive";
  const stockUnitLabel = stockingUnit?.name ?? "units";
  const itemSidebar =
    isMaster || isVariant ? null : itemType === "material" ? (
      <CreateSidebarCard
        title="Live preview"
        footer={
          safetyStock > 0 && stockOnHand < safetyStock ? (
            <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
              Stock is below safety level. Plan a purchase order.
            </div>
          ) : null
        }
      >
        <SummaryRows
          rows={[
            {
              label: "Margin",
              value: marginPercent == null ? "\u2014" : `${marginPercent.toFixed(1)}%`,
              valueClassName: marginClass,
            },
            {
              label: "Markup over cost",
              value:
                unitProfit == null
                  ? "\u2014"
                  : (formatPrice(unitProfit.toFixed(2)) ?? "$0.00"),
            },
            {
              label: "Stock on hand",
              value: `${stockOnHand} ${stockUnitLabel}`,
            },
            {
              label: "Stock value",
              value:
                materialCost == null
                  ? "\u2014"
                  : (formatPrice((stockOnHand * materialCost).toFixed(2)) ?? "$0.00"),
            },
          ]}
        />
      </CreateSidebarCard>
    ) : (
      <CreateSidebarCard
        title="Cost & margin"
        footer={
          <div className="flex w-full items-center justify-between gap-4">
            <span className="text-sm text-muted-foreground">Profit / unit</span>
            <span className="font-mono text-lg font-semibold tabular-nums">
              {unitProfit == null
                ? "\u2014"
                : (formatPrice(unitProfit.toFixed(2)) ?? "$0.00")}
            </span>
          </div>
        }
      >
        <SummaryRows
          rows={[
            {
              label: "Estimated cost",
              value:
                materialCost == null
                  ? "\u2014"
                  : (formatPrice(materialCost.toFixed(2)) ?? "$0.00"),
            },
            {
              label: "Selling price",
              value: formatPrice(sellingPrice.toFixed(2)) ?? "$0.00",
            },
            {
              label: "Margin",
              value: marginPercent == null ? "\u2014" : `${marginPercent.toFixed(1)}%`,
              valueClassName: marginClass,
            },
          ]}
        />
      </CreateSidebarCard>
    );

  return (
    <CreatePageShell>
      <CreatePageHeader
        eyebrow={`Inventory · ${itemType === "product" ? "Products" : "Materials"}`}
        title={
          isEditing
            ? isMaster
              ? "Edit Variant Master"
              : isVariant
              ? "Edit Variant"
              : `Edit ${typeLabel}`
            : isMaster
              ? "Add Variant Master"
              : `Add ${typeLabel}`
        }
        badge={
          itemType === "product" && !isEditing ? (
            <Badge variant="secondary">
              {isMaster ? "Variant master" : "Standard product"}
            </Badge>
          ) : null
        }
        actions={
          <>
          {showMasterToggle && (
            <Tooltip>
              <TooltipTrigger asChild>
                <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                  <Switch
                    checked={isMaster}
                    onCheckedChange={setIsMaster}
                  />
                  Variant master
                </label>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs">
                Create a parent row for variants with separate stock, SKU, and pricing.
              </TooltipContent>
            </Tooltip>
          )}
          <Button
            type="button"
            variant="outline"
            onClick={handleCancel}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            form="item-form"
            disabled={mutation.isPending}
          >
            {submitLabel}
          </Button>
          </>
        }
      />

      {formError && <FieldError>{formError}</FieldError>}

      <CreatePageGrid sidebar={itemSidebar}>
      <form
        id="item-form"
        onSubmit={form.handleSubmit((data) => {
          if (!mutation.isPending) mutation.mutate(data);
        }, handleInvalidSubmit)}
      >
        <FieldGroup className="gap-6">
          <CreateSection title="Basics">
            <FieldGroup>
              {isVariant ? (
                <div className="grid gap-4 md:grid-cols-2">
                  <Field>
                    <input
                      type="hidden"
                      {...form.register("name")}
                      value={variantFamilyName}
                      readOnly
                    />
                    <FieldLabel htmlFor="variant-family-name">Master Name</FieldLabel>
                    <Input
                      id="variant-family-name"
                      value={variantFamilyName}
                      readOnly
                      className="bg-muted/40 text-muted-foreground"
                    />
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="variant-title">Variant Title</FieldLabel>
                    <Input
                      id="variant-title"
                      value={variantTitle}
                      readOnly
                      className="bg-muted/40 font-medium"
                    />
                  </Field>
                </div>
              ) : (
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
                        placeholder="e.g. Sand, Gravel, Topsoil"
                        autoComplete="off"
                      />
                      {fieldState.invalid && (
                        <FieldError errors={[fieldState.error]} />
                      )}
                    </Field>
                  )}
                />
              )}

              <Controller
                name="description"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor={field.name}>Description</FieldLabel>
                    <Textarea
                      {...field}
                      id={field.name}
                      value={field.value ?? ""}
                      aria-invalid={fieldState.invalid}
                      placeholder={`Optional notes about this ${typeLabel.toLowerCase()}`}
                      rows={3}
                      autoComplete="off"
                    />
                    {fieldState.invalid && (
                      <FieldError errors={[fieldState.error]} />
                    )}
                  </Field>
                )}
              />


              <div className="grid gap-4 md:grid-cols-2">
                {!isMaster && (
                  <Controller
                    name="sku"
                    control={form.control}
                    render={({ field, fieldState }) => (
                      <Field data-invalid={fieldState.invalid}>
                        <FieldLabel htmlFor={field.name}>
                          <TooltipHeader label="SKU" tooltip={ITEM_SKU_TOOLTIP} />
                        </FieldLabel>
                        <Input
                          {...field}
                          id={field.name}
                          value={field.value ?? ""}
                          aria-invalid={fieldState.invalid}
                          placeholder={itemType === "product" ? "PRD-001" : "MAT-001"}
                          autoComplete="off"
                        />
                        {fieldState.invalid && (
                          <FieldError errors={[fieldState.error]} />
                        )}
                      </Field>
                    )}
                  />
                )}

                <Controller
                  name="category"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor={field.name}>
                        <TooltipHeader label="Category" tooltip={ITEM_CATEGORY_TOOLTIP} />
                      </FieldLabel>
                      <Combobox
                        items={categoryItems}
                        value={field.value ?? ""}
                        onValueChange={(v) => field.onChange(v || null)}
                        onInputValueChange={setCategoryInput}
                      >
                        <ComboboxInput
                          placeholder="Search or create category..."
                        />
                        <ComboboxContent>
                          <ComboboxEmpty>
                            Type to create a new category
                          </ComboboxEmpty>
                          <ComboboxList>
                            {(item: string) => (
                              <ComboboxItem key={item} value={item}>
                                {categoriesSet.has(item.toLowerCase())
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

              {!isMaster && initialData ? (
                <Field>
                  <FieldLabel>
                    <TooltipHeader label="Stocking Unit" tooltip={STOCKING_UNIT_TOOLTIP} />
                  </FieldLabel>
                  <p className="py-2 text-sm">
                    {initialData.unitName} ({initialData.unitSize} {initialData.unitUom})
                  </p>
                </Field>
              ) : !isMaster ? (
                <Controller
                  name="unitDefinitionId"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor={field.name}>
                        <TooltipHeader label="Stocking Unit" tooltip={STOCKING_UNIT_TOOLTIP} />
                      </FieldLabel>
                      <Select
                        key={field.value as string}
                        name={field.name}
                        value={field.value as string}
                        onValueChange={(value) => {
                          if (value === CREATE_NEW_UNIT) {
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
                          <SelectValue placeholder="Select a stocking unit" />
                        </SelectTrigger>
                        <SelectContent>
                          {localUnits.map((u) => (
                            <SelectItem key={u.id} value={u.id}>
                              {u.name} ({u.size} {u.uom})
                            </SelectItem>
                          ))}
                          <SelectSeparator />
                          <SelectItem value={CREATE_NEW_UNIT}>
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
              ) : null}

              {!isMaster && (
                <Controller
                  name="purchaseUnitDefinitionId"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor={field.name}>
                        <TooltipHeader label="Purchase Unit" tooltip={PURCHASE_UNIT_TOOLTIP} />
                      </FieldLabel>
                      <Select
                        name={field.name}
                        value={(field.value as string | null) ?? "__none__"}
                        onValueChange={(value) => {
                          field.onChange(value === "__none__" ? null : value);
                        }}
                      >
                        <SelectTrigger
                          id={field.name}
                          aria-invalid={fieldState.invalid}
                          className="w-full"
                        >
                          <SelectValue placeholder="Purchased in stocking units" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">Purchased in stocking units</SelectItem>
                          <SelectSeparator />
                          {localUnits.map((u) => (
                            <SelectItem key={u.id} value={u.id}>
                              {u.name} ({u.size} {u.uom})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {fieldState.invalid && (
                        <FieldError errors={[fieldState.error]} />
                      )}
                    </Field>
                  )}
                />
              )}

              {itemType === "product" && !isMaster && (
                <Controller
                  name="sellable"
                  control={form.control}
                  render={({ field }) => (
                    <Field orientation="horizontal">
                      <Checkbox
                        id={field.name}
                        checked={field.value ?? false}
                        onCheckedChange={(checked) => field.onChange(checked === true)}
                      />
                      <FieldLabel htmlFor={field.name}>Sellable</FieldLabel>
                    </Field>
                  )}
                />
              )}

              {!isMaster && purchaseUnit && stockingUnit && derivedPurchaseFactor != null ? (
                <Field>
                  <FieldLabel>
                    <TooltipHeader
                      label="Purchase Conversion"
                      tooltip={PURCHASE_CONVERSION_TOOLTIP}
                    />
                  </FieldLabel>
                  <p className="py-2 text-sm text-muted-foreground">
                    1 {purchaseUnit.name} = {derivedPurchaseFactor} {stockingUnit.name}
                  </p>
                </Field>
              ) : null}

              {!isMaster && purchaseUnit && stockingUnit && derivedPurchaseFactor == null ? (
                <Controller
                  name="purchaseToStockFactor"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor={field.name}>
                        <TooltipHeader
                          label="Stocking Units per 1 Purchase Unit"
                          tooltip={PURCHASE_CONVERSION_TOOLTIP}
                        />
                      </FieldLabel>
                      <Input
                        {...field}
                        id={field.name}
                        value={(field.value as string | null) ?? ""}
                        onChange={(event) => field.onChange(event.target.value || null)}
                        aria-invalid={fieldState.invalid}
                        placeholder={`How many ${stockingUnit.name} per 1 ${purchaseUnit.name}?`}
                        inputMode="decimal"
                        autoComplete="off"
                      />
                      {fieldState.invalid && (
                        <FieldError errors={[fieldState.error]} />
                      )}
                    </Field>
                  )}
                />
              ) : null}
            </FieldGroup>
          </CreateSection>

          {isMaster && (
            <CreateSection
              title="Variant axes"
            >
                <FieldGroup>
                  <Controller
                    name="variantAxes"
                    control={form.control}
                    render={({ field, fieldState }) => (
                      <Field data-invalid={fieldState.invalid}>
                        <FieldLabel>Axes</FieldLabel>
                        <AxesInput
                          value={(field.value as string[]) ?? []}
                          onChange={field.onChange}
                        />
                        {fieldState.invalid && (
                          <FieldError errors={[fieldState.error as { message?: string } | undefined]} />
                        )}
                      </Field>
                    )}
                  />
                </FieldGroup>
            </CreateSection>
          )}

          {!isMaster && (
          <CreateSection
            title="Pricing & stock"
          >
            <FieldGroup>
              <div className="grid gap-4 md:grid-cols-2">
                {itemType === "material" && (
                  <Controller
                    name="defaultPurchasePrice"
                    control={form.control}
                    render={({ field, fieldState }) => (
                      <Field data-invalid={fieldState.invalid}>
                        <FieldLabel htmlFor={field.name}>
                          <TooltipHeader label="Purchase Price" tooltip={PURCHASE_PRICE_TOOLTIP} />
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
                        <FieldDescription>
                          {purchaseUnit
                            ? `Per ${purchaseUnit.name}; converts to ${stockingUnit?.name ?? "stock"} cost.`
                            : `Per ${stockingUnit?.name ?? "stock"} unit.`}
                        </FieldDescription>
                        {fieldState.invalid && (
                          <FieldError errors={[fieldState.error]} />
                        )}
                      </Field>
                    )}
                  />
                )}

                {itemType === "material" && (
                  <Controller
                    name="currentStockUnitCost"
                    control={form.control}
                    render={({ field, fieldState }) => (
                      <Field data-invalid={fieldState.invalid}>
                        <FieldLabel htmlFor={field.name}>
                          <TooltipHeader
                            label="Current Stock Unit Cost"
                            tooltip={CURRENT_STOCK_UNIT_COST_TOOLTIP}
                          />
                        </FieldLabel>
                        <Input
                          {...field}
                          id={field.name}
                          value={field.value ?? ""}
                          onChange={(event) => field.onChange(event.target.value || null)}
                          aria-invalid={fieldState.invalid}
                          placeholder="0.00"
                          inputMode="decimal"
                          autoComplete="off"
                          readOnly={isEditing}
                          className={isEditing ? "bg-muted/40 text-muted-foreground" : undefined}
                        />
                        <FieldDescription>
                          Auto-updated from stock and receipts.
                        </FieldDescription>
                        {isEditing && (
                          <div className="pt-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setCurrentStockUnitCostDraft(
                                  ((form.getValues("currentStockUnitCost" as never) as unknown as string | null) ??
                                    "")
                                );
                                setCurrentStockUnitCostError(null);
                                setCurrentStockUnitCostDialogOpen(true);
                              }}
                            >
                              Override current stock unit cost
                            </Button>
                          </div>
                        )}
                        {fieldState.invalid && (
                          <FieldError errors={[fieldState.error]} />
                        )}
                      </Field>
                    )}
                  />
                )}

                <Controller
                  name="defaultSellingPrice"
                  control={form.control}
                  render={({ field, fieldState }) => (
                      <Field data-invalid={fieldState.invalid}>
                        <FieldLabel htmlFor={field.name}>
                          <TooltipHeader label="Selling Price" tooltip={SELLING_PRICE_TOOLTIP} />
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
                  name="stock"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor={field.name}>
                        <TooltipHeader label="Stock" tooltip={ON_HAND_STOCK_TOOLTIP} />
                      </FieldLabel>
                      <Input
                        {...field}
                        id={field.name}
                        value={field.value ?? ""}
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

                <Controller
                  name="safetyStock"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor={field.name}>
                        <TooltipHeader label="Safety Stock" tooltip={SAFETY_STOCK_TOOLTIP} />
                      </FieldLabel>
                      <Input
                        {...field}
                        id={field.name}
                        value={field.value ?? ""}
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
            </FieldGroup>
          </CreateSection>
          )}

          {itemType === "product" && availableComponents && !isMaster && (
            <CreateSection
              title="Recipe / Bill of Materials"
              action={
                <div className="flex items-center gap-2">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            className="shrink-0"
                            aria-label={bomLocked ? "Unlock recipe" : "Lock recipe"}
                            disabled={!canManageBomLock}
                            onClick={() => {
                              setPendingBomLocked(!bomLocked);
                              setBomLockConfirmOpen(true);
                            }}
                          >
                            <HugeiconsIcon
                              icon={bomLocked ? CircleLock01Icon : CircleUnlock01Icon}
                              strokeWidth={2}
                            />
                          </Button>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        {canManageBomLock
                          ? bomLocked
                            ? "Locked. Click to unlock."
                            : "Unlocked. Click to lock."
                          : "Inventory admin access required."}
                      </TooltipContent>
                    </Tooltip>
                  </div>
              }
            >
                <FieldGroup>
                  <div className="grid gap-4 md:grid-cols-3">
                    <Controller
                      control={form.control}
                      name="typicalBatchSize"
                      render={({ field, fieldState }) => (
                        <Field data-invalid={fieldState.invalid}>
                          <FieldLabel htmlFor={field.name}>
                            Typical Batch Size
                          </FieldLabel>
                          <Input
                            {...field}
                            id={field.name}
                            value={field.value ?? ""}
                            aria-invalid={fieldState.invalid}
                            inputMode="decimal"
                            autoComplete="off"
                            placeholder="0"
                          />
                          {fieldState.invalid ? (
                            <FieldError errors={[fieldState.error]} />
                          ) : null}
                        </Field>
                      )}
                    />
                    <Controller
                      control={form.control}
                      name="typicalGroupSize"
                      render={({ field, fieldState }) => (
                        <Field data-invalid={fieldState.invalid}>
                          <FieldLabel htmlFor={field.name}>
                            Typical Group Size
                          </FieldLabel>
                          <Input
                            {...field}
                            id={field.name}
                            value={field.value ?? ""}
                            aria-invalid={fieldState.invalid}
                            inputMode="decimal"
                            autoComplete="off"
                            placeholder="0"
                          />
                          {fieldState.invalid ? (
                            <FieldError errors={[fieldState.error]} />
                          ) : null}
                        </Field>
                      )}
                    />
                    <Controller
                      control={form.control}
                      name="standardCostQuantity"
                      render={({ field, fieldState }) => (
                        <Field data-invalid={fieldState.invalid}>
                          <FieldLabel htmlFor={field.name}>
                            Standard Costing Quantity
                          </FieldLabel>
                          <Input
                            {...field}
                            id={field.name}
                            value={field.value ?? ""}
                            aria-invalid={fieldState.invalid}
                            inputMode="decimal"
                            autoComplete="off"
                            placeholder="0"
                          />
                          {fieldState.invalid ? (
                            <FieldError errors={[fieldState.error]} />
                          ) : null}
                        </Field>
                      )}
                    />
                  </div>
                </FieldGroup>
                <div className="space-y-(--space-4)">
                  <h3 className="text-[length:var(--text-base)] font-semibold">Materials</h3>
                  <BomEditor
                    initialRows={(initialData?.bom ?? []) as BomPayloadRow[]}
                    availableComponents={availableComponents}
                    typicalBatchSize={watchedTypicalBatchSize}
                    typicalGroupSize={watchedTypicalGroupSize}
                    error={
                      (form.formState.errors as Record<string, unknown>).bom
                    }
                    onRowsChange={handleBomRowsChange}
                  />
                </div>
                <div className="space-y-(--space-4)">
                  <h3 className="text-[length:var(--text-base)] font-semibold">
                    Standard Operation Costs
                  </h3>
                  <OperationCostEditor
                    initialRows={initialData?.operationCosts}
                    resources={manufacturingResources}
                    expectedBatchYield={watchedExpectedBatchYield}
                    typicalBatchSize={watchedTypicalBatchSize}
                    standardCostQuantity={watchedStandardCostQuantity}
                    error={
                      (form.formState.errors as Record<string, unknown>).operationCosts
                    }
                    onRowsChange={handleOperationCostRowsChange}
                  />
                </div>
                {isBomDirty ? (
                  <FieldGroup>
                    <Field>
                      <FieldDescription>
                        Creates a new BOM revision on save.
                      </FieldDescription>
                    </Field>
                    <Controller
                      name="revisionNote"
                      control={form.control}
                      render={({ field, fieldState }) => (
                        <Field data-invalid={fieldState.invalid}>
                          <FieldLabel htmlFor={field.name}>Revision Note</FieldLabel>
                          <Textarea
                            {...field}
                            id={field.name}
                            value={field.value ?? ""}
                            onChange={(event) => field.onChange(event.target.value || null)}
                            aria-invalid={fieldState.invalid}
                            placeholder="Optional note about what changed in this recipe"
                            rows={2}
                            autoComplete="off"
                          />
                          {fieldState.invalid ? (
                            <FieldError errors={[fieldState.error]} />
                          ) : null}
                        </Field>
                      )}
                    />
                  </FieldGroup>
                ) : null}
            </CreateSection>
          )}
        </FieldGroup>
      </form>
      <BomLockConfirmDialog
        open={bomLockConfirmOpen}
        onOpenChange={(open) => {
          setBomLockConfirmOpen(open);
          if (!open) {
            setPendingBomLocked(null);
          }
        }}
        title={lockDialogTitle}
        description={lockDialogDescription}
        confirmLabel={lockTarget ? "Lock BOM" : "Unlock BOM"}
        onConfirm={() => {
          if (pendingBomLocked == null) return;

          form.setValue("bomLocked", pendingBomLocked, {
            shouldDirty: true,
            shouldTouch: true,
          });
          setPendingBomLocked(null);
        }}
      />
      <CurrentStockCostDialog
        open={currentStockUnitCostDialogOpen}
        onOpenChange={(open) => {
          setCurrentStockUnitCostDialogOpen(open);
          if (!open) {
            setCurrentStockUnitCostError(null);
            setCurrentStockUnitCostDraft(
              ((form.getValues("currentStockUnitCost" as never) as unknown as string | null) ??
                "")
            );
          }
        }}
        value={currentStockUnitCostDraft}
        onValueChange={setCurrentStockUnitCostDraft}
        error={currentStockUnitCostError}
        isPending={currentStockUnitCostMutation.isPending}
        onConfirm={() => currentStockUnitCostMutation.mutate()}
      />
      <CreateUnitDialog
        open={isUnitDialogOpen}
        onOpenChange={(open) => {
          setIsUnitDialogOpen(open);
          if (!open) {
            resetUnitForm();
            setUnitError(null);
          }
        }}
        name={unitName}
        onNameChange={setUnitName}
        size={unitSize}
        onSizeChange={setUnitSize}
        uom={unitUom}
        onUomChange={setUnitUom}
        uomGroups={uomGroups}
        sizeInvalid={unitSizeInvalid}
        error={unitError}
        isPending={unitMutation.isPending}
        canSubmit={
          !unitMutation.isPending &&
          Boolean(unitName.trim()) &&
          POSITIVE_NUMBER_RE.test(unitSize.trim()) &&
          Boolean(unitUom)
        }
        onSubmit={() => unitMutation.mutate()}
      />
      </CreatePageGrid>
    </CreatePageShell>
  );
}
