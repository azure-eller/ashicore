"use client";

import { useId, useMemo } from "react";
import { useWatch, Controller, type Control } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { InventoryItemCombobox } from "@/components/inventory-item-combobox";
import { EditableLineGridCell } from "@/components/editable-line-grid";
import {
  EditableLineItems,
} from "@/components/editable-line-items";
import type {
  InsertItemFormValues,
  UpdateItemFormValues,
} from "@/lib/schemas/items";

type AvailableComponent = {
  id: string;
  name: string;
  displayName: string;
  itemType: string;
  unit: string;
};

type ItemFormValues = InsertItemFormValues | UpdateItemFormValues;

const BOM_LINE_GRID_COLUMNS =
  "minmax(14rem, 1.4fr) minmax(6rem, 0.65fr) minmax(6.5rem, 0.6fr) minmax(5.5rem, 0.5fr)";

const blankBomLine = {
  componentId: "",
  quantity: null,
  minimumLotAgeDays: null,
  alternates: [],
};

interface BomEditorProps {
  control: Control<ItemFormValues>;
  availableComponents: AvailableComponent[];
  manufacturingMode?: string;
}

export function BomEditor({ control, availableComponents, manufacturingMode = "discrete" }: BomEditorProps) {
  const isBatch = manufacturingMode === "batch";
  const componentMap = useMemo(
    () => new Map(availableComponents.map((c) => [c.id, c])),
    [availableComponents]
  );
  const componentOptions = useMemo(
    () =>
      availableComponents.map((component) => ({
        ...component,
        unitName: component.unit,
      })),
    [availableComponents]
  );

  return (
    <div className="flex w-full flex-col gap-6">
      <EditableLineItems<ItemFormValues, "bom">
        control={control}
        name="bom"
        columns={BOM_LINE_GRID_COLUMNS}
        minWidth="40rem"
        createLine={() => ({ ...blankBomLine, alternates: [] })}
        addLabel="Add ingredient"
        emptyMessage="No ingredients yet."
        headers={[
          "Component",
          isBatch ? "Qty / Batch" : "Qty",
          "Min Age",
          "Unit",
        ]}
        renderRow={({ field, index, appendLineAfterCommit }) => (
          <BomRow
            key={field.id}
            index={index}
            control={control}
            componentOptions={componentOptions}
            componentMap={componentMap}
            appendLineAfterCommit={appendLineAfterCommit}
          />
        )}
      />
    </div>
  );
}

/** Extracted sub-component so useWatch can be called at the top level (Rules of Hooks). */
function BomRow({
  index,
  control,
  componentOptions,
  componentMap,
  appendLineAfterCommit,
}: {
  index: number;
  control: Control<ItemFormValues>;
  componentOptions: Array<AvailableComponent & { unitName: string }>;
  componentMap: Map<string, AvailableComponent>;
  appendLineAfterCommit: () => void;
}) {
  const rowDomId = useId();
  const componentId = useWatch({ control, name: `bom.${index}.componentId` });
  const selectedComponent = componentMap.get(componentId ?? "");

  return (
    <>
      <EditableLineGridCell>
        <Controller
          name={`bom.${index}.componentId`}
          control={control}
          render={({ field: f, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel className="sr-only" htmlFor={`${rowDomId}-component`}>
                Component
              </FieldLabel>
              <InventoryItemCombobox
                options={componentOptions}
                value={f.value ?? ""}
                onValueChange={(id) => {
                  f.onChange(id ?? "");
                  if (id) {
                    appendLineAfterCommit();
                  }
                }}
                inputId={`${rowDomId}-component`}
                inputAriaInvalid={fieldState.invalid}
                inputPrimaryFocus
                inputClassName="w-full min-w-0"
                placeholder="Search items..."
                emptyMessage="No items found"
                contentClassName="w-[min(32rem,calc(100vw-2rem))]"
                showTypeBadge
                createLinks={[
                  {
                    href: "/inventory/products/new",
                    label: "Create product",
                  },
                  {
                    href: "/inventory/materials/new",
                    label: "Create material",
                  },
                ]}
                getSecondaryText={(component) => component.unit}
              />
              {fieldState.invalid && (
                <FieldError errors={[fieldState.error]} />
              )}
            </Field>
          )}
        />
      </EditableLineGridCell>
      <EditableLineGridCell>
        <Controller
          name={`bom.${index}.quantity`}
          control={control}
          render={({ field: f, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel className="sr-only" htmlFor={`${rowDomId}-quantity`}>
                Quantity
              </FieldLabel>
              <Input
                {...f}
                id={`${rowDomId}-quantity`}
                value={f.value ?? ""}
                aria-invalid={fieldState.invalid}
                placeholder="0"
                inputMode="decimal"
                autoComplete="off"
                className="w-full min-w-0"
              />
              {fieldState.invalid && (
                <FieldError errors={[fieldState.error]} />
              )}
            </Field>
          )}
        />
      </EditableLineGridCell>
      <EditableLineGridCell>
        <Controller
          name={`bom.${index}.minimumLotAgeDays`}
          control={control}
          render={({ field: f, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel className="sr-only" htmlFor={`${rowDomId}-min-age`}>
                Min Age
              </FieldLabel>
              <Input
                {...f}
                id={`${rowDomId}-min-age`}
                value={f.value ?? ""}
                aria-invalid={fieldState.invalid}
                placeholder="0"
                inputMode="numeric"
                autoComplete="off"
                className="w-full min-w-0"
              />
              {fieldState.invalid && (
                <FieldError errors={[fieldState.error]} />
              )}
            </Field>
          )}
        />
      </EditableLineGridCell>
      <EditableLineGridCell>
        <div className="flex h-8 items-center text-sm text-muted-foreground">
          {selectedComponent?.unit ?? "\u2014"}
        </div>
      </EditableLineGridCell>
    </>
  );
}
