"use client";

import { type ReactNode } from "react";
import type {
  CellClassParams,
  ICellRendererParams,
  ValueFormatterParams,
  ValueSetterParams,
} from "ag-grid-community";
import {
  type PurchaseOrderAdditionalCostDistributionMethod,
  type PurchaseOrderAdditionalCostType,
} from "@/lib/schemas/purchase-orders";
import { formatAddressLines } from "@/lib/addresses";
import {
  formatPrice,
  normalizeMoney,
} from "@/lib/format";
import {
  normalizeLandedStockUnitCost,
  type LandedCostLineResult,
} from "@/lib/purchasing/landed-cost";
import {
  Field,
  FieldLabel,
} from "@/components/ui/field";
import {
  type LineField,
} from "@/components/editable-lines";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxSeparator,
} from "@/components/ui/combobox";
import {
  PO_LINE_TOTAL_TOOLTIP,
  PURCHASE_ADDITIONAL_COST_TYPE_TOOLTIP,
  PURCHASE_COST_AMOUNT_TOOLTIP,
  PURCHASE_COST_DISTRIBUTION_TOOLTIP,
  PURCHASE_COST_REFERENCE_TOOLTIP,
  PURCHASE_MATERIAL_TOOLTIP,
  PO_ORDERED_QTY_TOOLTIP,
  PURCHASE_UNIT_COST_TOOLTIP,
  PURCHASE_UNIT_TOOLTIP,
} from "@/lib/tooltip-copy";
import type {
  PurchaseOrderMaterialOption,
  PurchaseOrderTaxRateOption,
  SupplierOption,
} from "@/lib/purchasing/types";
import styles from "@/components/card-page/card-page.module.css";

import { fieldErrorAt, type FieldErrorRecord } from "@/lib/api/field-errors";
import {
  ADDITIONAL_COST_DISTRIBUTION_LABELS,
  ADDITIONAL_COST_TYPE_LABELS,
  hasPurchaseOrderAdditionalCostAmount,
  isBlankPurchaseOrderAdditionalCost,
  isBlankPurchaseOrderLine,
  lineTotalLabel,
  normalizeGridText,
  normalizeNullableGridText,
  parseNonNegative,
  validateNonNegativeMoneyCell,
  ADD_DELIVERY_ADDRESS_VALUE,
  EDIT_DELIVERY_ADDRESS_VALUE,
  deliveryAddressContentKey,
  deliveryAddressKey,
  type DeliveryAddressFields,
  type DeliveryAddressOption,
  type PurchaseOrderAdditionalCostGridRow,
  type PurchaseOrderAdditionalCostColumnKey,
  type PurchaseOrderLineColumnKey,
  type PurchaseOrderLineGridRow,
} from "./purchase-order-card-shared";

function PurchaseMaterialCell({
  data,
  materialMap,
}: ICellRendererParams<PurchaseOrderLineGridRow> & {
  materialMap: Map<string, PurchaseOrderMaterialOption>;
}) {
  if (!data?.itemId) {
    return <span className="text-[var(--color-ink-faint)]">Search items...</span>;
  }

  return (
    <span className="block truncate">
      {materialMap.get(data.itemId)?.name ?? data.itemId}
    </span>
  );
}

function PurchaseUnitCell({
  data,
  materialMap,
}: ICellRendererParams<PurchaseOrderLineGridRow> & {
  materialMap: Map<string, PurchaseOrderMaterialOption>;
}) {
  const material = data?.itemId ? materialMap.get(data.itemId) : undefined;

  return (
    <span className="text-[var(--color-ink-faint)]">
      {material?.purchaseUnitName ?? material?.stockingUnitName ?? "\u2014"}
    </span>
  );
}

function PurchaseLineTotalCell({
  data,
  taxRateMap,
}: ICellRendererParams<PurchaseOrderLineGridRow> & {
  taxRateMap: Map<string, PurchaseOrderTaxRateOption>;
}) {
  return (
    <span className="font-medium">
      {lineTotalLabel(
        data?.quantityOrdered,
        data?.unitCost,
        data?.taxRateId,
        taxRateMap,
      )}
    </span>
  );
}

function PurchaseLandedCostCell({
  data,
  materialMap,
  landedCostByRowId,
}: ICellRendererParams<PurchaseOrderLineGridRow> & {
  materialMap: Map<string, PurchaseOrderMaterialOption>;
  landedCostByRowId: Map<string, LandedCostLineResult>;
}) {
  const result = data?.clientRowId
    ? landedCostByRowId.get(data.clientRowId)
    : null;
  const unitCost = normalizeLandedStockUnitCost(result?.landedStockUnitCost ?? null);
  const material = data?.itemId ? materialMap.get(data.itemId) : undefined;

  if (!unitCost) {
    return <span className="text-[var(--color-ink-faint)]">—</span>;
  }

  return (
    <span className="block truncate font-medium">
      {formatPrice(unitCost) ?? "$0.00"}
      <span className="text-[var(--color-ink-faint)]">
        {" / "}
        {material?.stockingUnitName ?? "unit"}
      </span>
    </span>
  );
}


export function buildPurchaseOrderLineColumns({
  additionalCostsExpanded,
  fieldErrors,
  landedCostByRowId,
  lineGridRows,
  materialMap,
  materialOptions,
  receivedMaterialIds,
  materialLinesReadOnly,
  taxRates,
  taxRateMap,
}: {
  additionalCostsExpanded: boolean;
  fieldErrors: FieldErrorRecord | null;
  landedCostByRowId: Map<string, LandedCostLineResult>;
  lineGridRows: PurchaseOrderLineGridRow[];
  materialMap: Map<string, PurchaseOrderMaterialOption>;
  materialOptions: (PurchaseOrderMaterialOption & {
    displayName: string;
    unitName: string;
  })[];
  receivedMaterialIds: Set<string>;
  materialLinesReadOnly: boolean;
  taxRates: PurchaseOrderTaxRateOption[];
  taxRateMap: Map<string, PurchaseOrderTaxRateOption>;
}): LineField<PurchaseOrderLineGridRow>[] {
    const nonBlankRows = lineGridRows.filter(
      (row) => !isBlankPurchaseOrderLine(row),
    );
    const rowErrorIndex = (row: PurchaseOrderLineGridRow) =>
      nonBlankRows.findIndex(
        (current) => current.clientRowId === row.clientRowId,
      );
    const cellError = (row: PurchaseOrderLineGridRow, key: PurchaseOrderLineColumnKey) => {
      const index = rowErrorIndex(row);
      return index >= 0 ? fieldErrorAt(fieldErrors, ["lines", index, key]) : null;
    };
    const hasCellError =
      (key: PurchaseOrderLineColumnKey) =>
      (params: CellClassParams<PurchaseOrderLineGridRow>) =>
        params.data ? cellError(params.data, key) != null : false;
    const cellTooltip =
      (key: PurchaseOrderLineColumnKey) =>
      ({ data }: { data?: PurchaseOrderLineGridRow }) => {
        if (!data) return null;
        if (key === "itemId" && receivedMaterialIds.has(data.itemId ?? "")) {
          return "Received material lines cannot change item. Add another line for a different material.";
        }
        return cellError(data, key);
      };

    const columns: LineField<PurchaseOrderLineGridRow>[] = [
      {
        field: "itemId",
        kind: "inventory-item",
        headerName: "Item",
        headerTooltip: PURCHASE_MATERIAL_TOOLTIP,
        minWidth: 300,
        flex: 1.6,
        editable: (data) => !materialLinesReadOnly && !receivedMaterialIds.has(data?.itemId ?? ""),
        options: materialOptions,
        placeholder: "Search or create item",
        emptyMessage: "No materials found",
        requiredMessage: "Material is required",
        isRowBlank: isBlankPurchaseOrderLine,
        getDraftRow: (row: PurchaseOrderLineGridRow, itemId: string) => ({
          ...row,
          itemId,
        }),
        createLinks: [
          {
            href: "/inventory/material",
            label: "Create material",
          },
          {
            href: "/inventory/product",
            label: "Create product",
          },
        ],
        getSecondaryText: (current) =>
          [current.sku, (current as PurchaseOrderMaterialOption).stockingUnitName]
            .filter((part): part is string => part != null && part !== "")
            .join(" · "),
        valueSetter: (
          params: ValueSetterParams<PurchaseOrderLineGridRow, string | null>,
        ) => {
          const materialId = normalizeGridText(params.newValue);
          params.data.itemId = materialId;
          params.data.unitCost =
            materialMap.get(materialId)?.defaultPurchasePrice ?? "0";
          return true;
        },
        cellRenderer: (
          params: ICellRendererParams<PurchaseOrderLineGridRow>,
        ) => <PurchaseMaterialCell {...params} materialMap={materialMap} />,
        cellClassRules: {
          "erp-editable-grid-cell-error": hasCellError("itemId"),
        },
        tooltipValueGetter: cellTooltip("itemId"),
      },
      {
        colId: "supplierItemCode",
        kind: "display",
        headerName: "Supplier item code",
        minWidth: 160,
        flex: 0.8,
        cellRenderer: () => <span className="text-[var(--color-ink-faint)]">—</span>,
      },
      {
        colId: "internalBarcode",
        kind: "display",
        headerName: "Internal barcode",
        minWidth: 160,
        flex: 0.8,
        cellRenderer: () => <span className="text-[var(--color-ink-faint)]">—</span>,
      },
      {
        field: "quantityOrdered",
        kind: "number",
        headerName: "Quantity",
        headerTooltip: PO_ORDERED_QTY_TOOLTIP,
        minWidth: 104,
        flex: 0.5,
        editable: !materialLinesReadOnly,
        valueSetter: (
          params: ValueSetterParams<PurchaseOrderLineGridRow, string | null>,
        ) => {
          params.data.quantityOrdered = normalizeNullableGridText(
            params.newValue,
          );
          return true;
        },
        getValidationErrors: (value, row) => {
          const nextRow = {
            ...row,
            quantityOrdered: normalizeNullableGridText(value),
          };
          if (isBlankPurchaseOrderLine(nextRow)) return null;
          const parsed = Number(nextRow.quantityOrdered);
          return Number.isFinite(parsed) && parsed > 0
            ? null
            : ["Quantity must be greater than 0"];
        },
        rightAligned: true,
        cellClassRules: {
          "erp-editable-grid-cell-error": hasCellError("quantityOrdered"),
        },
        tooltipValueGetter: cellTooltip("quantityOrdered"),
      },
      {
        colId: "purchaseUnit",
        kind: "display",
        headerName: "UoM",
        headerTooltip: PURCHASE_UNIT_TOOLTIP,
        minWidth: 96,
        flex: 0.4,
        cellRenderer: (
          params: ICellRendererParams<PurchaseOrderLineGridRow>,
        ) => <PurchaseUnitCell {...params} materialMap={materialMap} />,
      },
      {
        field: "unitCost",
        kind: "number",
        headerName: "Price per unit",
        headerTooltip: PURCHASE_UNIT_COST_TOOLTIP,
        minWidth: 132,
        flex: 0.65,
        editable: !materialLinesReadOnly,
        valueSetter: (
          params: ValueSetterParams<PurchaseOrderLineGridRow, string | null>,
        ) => {
          params.data.unitCost = normalizeNullableGridText(params.newValue);
          return true;
        },
        getValidationErrors: (value, row) => {
          const nextRow = {
            ...row,
            unitCost: normalizeNullableGridText(value),
          };
          if (isBlankPurchaseOrderLine(nextRow)) return null;
          const text = nextRow.unitCost?.trim() ?? "";
          if (!text) return ["Unit cost is required"];
          const parsed = Number(text);
          return Number.isFinite(parsed) && parsed >= 0
            ? null
            : ["Unit cost must be 0 or greater"];
        },
        valueFormatter: ({ value }) =>
          value == null || value === "" ? "" : (formatPrice(value) ?? value),
        rightAligned: true,
        cellClassRules: {
          "erp-editable-grid-cell-error": hasCellError("unitCost"),
        },
        tooltipValueGetter: cellTooltip("unitCost"),
      },
      {
        colId: "lineTotal",
        kind: "display",
        headerName: "Total price",
        headerTooltip: PO_LINE_TOTAL_TOOLTIP,
        minWidth: 136,
        flex: 0.65,
        cellRenderer: (
          params: ICellRendererParams<PurchaseOrderLineGridRow>,
        ) => <PurchaseLineTotalCell {...params} taxRateMap={taxRateMap} />,
      },
      {
        field: "taxRateId",
        kind: "select",
        headerName: "Tax",
        minWidth: 128,
        flex: 0.5,
        editable: !materialLinesReadOnly,
        values: ["", ...taxRates.map((rate) => rate.id)],
        valueFormatter: ({ value }) => {
          if (!value) return "0%";
          const rate = taxRateMap.get(String(value));
          return rate ? `${rate.ratePercent}% - ${rate.name}` : "0%";
        },
        valueSetter: (
          params: ValueSetterParams<PurchaseOrderLineGridRow, string | null>,
        ) => {
          params.data.taxRateId = params.newValue ? String(params.newValue) : null;
          return true;
        },
      },
    ];

    if (additionalCostsExpanded) {
      columns.push({
        colId: "landedCost",
        kind: "display",
        headerName: "Landed cost",
        minWidth: 156,
        flex: 0.7,
        cellRenderer: (
          params: ICellRendererParams<PurchaseOrderLineGridRow>,
        ) => (
          <PurchaseLandedCostCell
            {...params}
            materialMap={materialMap}
            landedCostByRowId={landedCostByRowId}
          />
        ),
      });
    }

    return columns;
}

export function buildPurchaseOrderAdditionalCostColumns({
  additionalCostGridRows,
  fieldErrors,
  additionalCostsReadOnly,
  createAdditionalCostSupplier,
  rememberSupplierForCurrentMaterials,
  supplierOptionsSorted,
}: {
  additionalCostGridRows: PurchaseOrderAdditionalCostGridRow[];
  fieldErrors: FieldErrorRecord | null;
  additionalCostsReadOnly: boolean;
  createAdditionalCostSupplier: () => Promise<{ value: string } | null>;
  rememberSupplierForCurrentMaterials: (supplierId: string | null) => void;
  supplierOptionsSorted: SupplierOption[];
}): LineField<PurchaseOrderAdditionalCostGridRow>[] {
    const payloadRows = additionalCostGridRows.filter(
      hasPurchaseOrderAdditionalCostAmount,
    );
    const rowErrorIndex = (row: PurchaseOrderAdditionalCostGridRow) =>
      payloadRows.findIndex(
        (current) => current.clientRowId === row.clientRowId,
      );
    const cellError = (
      row: PurchaseOrderAdditionalCostGridRow,
      key: PurchaseOrderAdditionalCostColumnKey,
    ) => {
      const index = rowErrorIndex(row);
      return index >= 0 ? fieldErrorAt(fieldErrors, ["additionalCosts", index, key]) : null;
    };
    const hasCellError =
      (key: PurchaseOrderAdditionalCostColumnKey) =>
      (params: CellClassParams<PurchaseOrderAdditionalCostGridRow>) =>
        params.data ? cellError(params.data, key) != null : false;
    const cellTooltip =
      (key: PurchaseOrderAdditionalCostColumnKey) =>
      ({ data }: { data?: PurchaseOrderAdditionalCostGridRow }) =>
        data ? cellError(data, key) : null;

    return [
      {
        field: "costType",
        kind: "select",
        headerName: "Cost",
        headerTooltip: PURCHASE_ADDITIONAL_COST_TYPE_TOOLTIP,
        minWidth: 128,
        flex: 0.75,
        editable: !additionalCostsReadOnly,
        values: Object.keys(ADDITIONAL_COST_TYPE_LABELS),
        valueFormatter: ({
          value,
        }: ValueFormatterParams<
          PurchaseOrderAdditionalCostGridRow,
          PurchaseOrderAdditionalCostType
        >) => ADDITIONAL_COST_TYPE_LABELS[value ?? "shipping"],
        valueSetter: (
          params: ValueSetterParams<
            PurchaseOrderAdditionalCostGridRow,
            PurchaseOrderAdditionalCostType
          >,
        ) => {
          params.data.costType = params.newValue ?? "shipping";
          return true;
        },
      },
      {
        field: "reference",
        kind: "text",
        headerName: "Reference",
        headerTooltip: PURCHASE_COST_REFERENCE_TOOLTIP,
        minWidth: 172,
        flex: 1.25,
        editable: !additionalCostsReadOnly,
        valueSetter: (
          params: ValueSetterParams<
            PurchaseOrderAdditionalCostGridRow,
            string | null
          >,
        ) => {
          params.data.reference = normalizeNullableGridText(params.newValue);
          return true;
        },
        valueFormatter: ({ value }) => value ?? "",
      },
      {
        field: "supplierId",
        kind: "select",
        headerName: "Supplier",
        minWidth: 180,
        flex: 1,
        editable: !additionalCostsReadOnly,
        values: ["", ...supplierOptionsSorted.map((supplier) => supplier.id)],
        createSelectOption: {
          label: "Create supplier...",
          onCreate: createAdditionalCostSupplier,
        },
        valueFormatter: ({ value }) => {
          if (!value) return "(PO supplier)";
          return (
            supplierOptionsSorted.find((supplier) => supplier.id === value)?.name ??
            "Supplier"
          );
        },
        valueSetter: (
          params: ValueSetterParams<
            PurchaseOrderAdditionalCostGridRow,
            string | null
          >,
        ) => {
          params.data.supplierId = params.newValue
            ? String(params.newValue)
            : null;
          rememberSupplierForCurrentMaterials(params.data.supplierId);
          return true;
        },
      },
      {
        field: "distributionMethod",
        kind: "select",
        headerName: "Distribution",
        headerTooltip: PURCHASE_COST_DISTRIBUTION_TOOLTIP,
        minWidth: 148,
        flex: 0.8,
        editable: !additionalCostsReadOnly,
        values: Object.keys(ADDITIONAL_COST_DISTRIBUTION_LABELS),
        valueFormatter: ({
          value,
        }: ValueFormatterParams<
          PurchaseOrderAdditionalCostGridRow,
          PurchaseOrderAdditionalCostDistributionMethod
        >) => ADDITIONAL_COST_DISTRIBUTION_LABELS[value ?? "by_value"],
        valueSetter: (
          params: ValueSetterParams<
            PurchaseOrderAdditionalCostGridRow,
            PurchaseOrderAdditionalCostDistributionMethod
          >,
        ) => {
          params.data.distributionMethod = params.newValue ?? "by_value";
          return true;
        },
      },
      {
        field: "amount",
        kind: "number",
        headerName: "Amount",
        headerTooltip: PURCHASE_COST_AMOUNT_TOOLTIP,
        minWidth: 128,
        flex: 0.65,
        editable: !additionalCostsReadOnly,
        valueSetter: (
          params: ValueSetterParams<
            PurchaseOrderAdditionalCostGridRow,
            string | null
          >,
        ) => {
          const parsed = parseNonNegative(normalizeGridText(params.newValue));
          params.data.amount =
            parsed == null
              ? normalizeNullableGridText(params.newValue)
              : normalizeMoney(parsed);
          return true;
        },
        getValidationErrors: (value, row) => {
          const nextRow = {
            ...row,
            amount: normalizeNullableGridText(value),
          };
          if (isBlankPurchaseOrderAdditionalCost(nextRow)) return null;
          return validateNonNegativeMoneyCell(
            value,
            nextRow.amount ? "Amount must be 0 or greater" : "Amount is required",
          );
        },
        valueFormatter: ({ value }) =>
          value == null || value === "" ? "" : (formatPrice(value) ?? value),
        cellClass: "num",
        cellClassRules: {
          "erp-editable-grid-cell-error": hasCellError("amount"),
        },
        tooltipValueGetter: cellTooltip("amount"),
      },
    ];
}

export function DeliveryAddressInput({
  id,
  label,
  value,
  options,
  onChange,
  onAddNew,
  onEdit,
  inputClassName,
  labelClassName,
  readOnly = false,
}: {
  id: string;
  label?: ReactNode;
  value: DeliveryAddressFields | undefined;
  options: DeliveryAddressOption[];
  onChange: (address: DeliveryAddressFields | null) => void;
  onAddNew: () => void;
  onEdit: (address: DeliveryAddressOption) => void;
  inputClassName?: string;
  labelClassName?: string;
  readOnly?: boolean;
}) {
  const currentAddressId = deliveryAddressKey(value);
  const canEditCurrent = currentAddressId !== "";
  const optionIds = options.map((option) => option.id);
  const optionMap = new Map(options.map((option) => [option.id, option]));
  const optionByContent = new Map(
    options.map((option) => [deliveryAddressContentKey(option), option]),
  );
  const currentContentKey = deliveryAddressContentKey(value);
  const matchedCurrentOption =
    optionMap.get(currentAddressId) ?? optionByContent.get(currentContentKey) ?? null;
  const currentComboboxValue = matchedCurrentOption?.id ?? currentAddressId;
  const items = canEditCurrent
    ? [...optionIds, EDIT_DELIVERY_ADDRESS_VALUE, ADD_DELIVERY_ADDRESS_VALUE]
    : [...optionIds, ADD_DELIVERY_ADDRESS_VALUE];
  const addressLines = formatAddressLines({
    line1: value?.shipLine1 ?? null,
    line2: value?.shipLine2 ?? null,
    city: value?.shipCity ?? null,
    region: value?.shipRegion ?? null,
    postcode: value?.shipPostcode ?? null,
    country: value?.shipCountry ?? null,
  });

  return (
    <Field>
      <FieldLabel className={labelClassName ?? (label ? undefined : "sr-only")} htmlFor={id}>
        {label ?? "Delivery Address"}
      </FieldLabel>
      {readOnly ? (
        <div className={styles.readOnlyFieldValue}>
          {addressLines.length > 0
            ? addressLines.map((line) => <div key={line}>{line}</div>)
            : "No delivery address set"}
        </div>
      ) : (
      <Combobox
        items={items}
        value={currentComboboxValue}
        onValueChange={(nextValue) => {
          if (!nextValue) {
            onChange(null);
            return;
          }
          if (nextValue === ADD_DELIVERY_ADDRESS_VALUE) {
            onAddNew();
            return;
          }
          if (nextValue === EDIT_DELIVERY_ADDRESS_VALUE) {
            if (matchedCurrentOption) onEdit(matchedCurrentOption);
            return;
          }

          onChange(optionMap.get(nextValue) ?? null);
        }}
        itemToStringLabel={(itemId) => {
          if (itemId === ADD_DELIVERY_ADDRESS_VALUE) return "Add new address";
          if (itemId === EDIT_DELIVERY_ADDRESS_VALUE)
            return "Edit selected address";
          return optionMap.get(itemId)?.label ?? "";
        }}
      >
        <ComboboxInput
          id={id}
          placeholder="Address"
          showClear={currentAddressId !== ""}
          className={inputClassName ?? "w-full min-w-0"}
        />
        <ComboboxContent className="w-[min(28rem,calc(100vw-2rem))] bg-[var(--color-surface)] text-[var(--color-ink)]">
          <ComboboxEmpty>No addresses found</ComboboxEmpty>
          <ComboboxList>
            {(itemId: string) => {
              if (itemId === ADD_DELIVERY_ADDRESS_VALUE) {
                return (
                  <ComboboxItem key={itemId} value={itemId}>
                    Add new address
                  </ComboboxItem>
                );
              }
              if (itemId === EDIT_DELIVERY_ADDRESS_VALUE) {
                return (
                  <ComboboxItem key={itemId} value={itemId}>
                    Edit selected address
                  </ComboboxItem>
                );
              }

              return (
                <ComboboxItem key={itemId} value={itemId}>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">
                      {optionMap.get(itemId)?.label}
                    </span>
                    {optionMap.get(itemId)?.shipContactName ? (
                      <span className="truncate text-xs text-[var(--color-ink-faint)]">
                        {optionMap.get(itemId)?.shipContactName}
                      </span>
                    ) : null}
                  </span>
                </ComboboxItem>
              );
            }}
          </ComboboxList>
          {optionIds.length > 0 ? <ComboboxSeparator /> : null}
        </ComboboxContent>
      </Combobox>
      )}
    </Field>
  );
}
