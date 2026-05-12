"use client";

import { useMemo } from "react";
import { useFieldArray, useWatch, Controller, type Control } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { InventoryItemCombobox } from "@/components/inventory-item-combobox";
import {
  EditableLineGrid,
  EditableLineGridCell,
  EditableLineGridRow,
} from "@/components/editable-line-grid";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import {
  SortableDragHandle,
  SortableReorder,
  useSortableReorderItem,
} from "@/components/sortable-reorder";
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
  "2.5rem minmax(16rem, 1fr) 8rem 7rem 6rem 2.5rem";

interface BomEditorProps {
  control: Control<ItemFormValues>;
  availableComponents: AvailableComponent[];
  manufacturingMode?: string;
}

export function BomEditor({ control, availableComponents, manufacturingMode = "discrete" }: BomEditorProps) {
  const isBatch = manufacturingMode === "batch";
  const { fields, append, move, remove } = useFieldArray({
    control,
    name: "bom",
  });

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
      {fields.length > 0 ? (
        <SortableReorder
          ids={fields.map((field) => field.id)}
          onMove={(fromIndex, toIndex) => move(fromIndex, toIndex)}
        >
          <EditableLineGrid
            columns={BOM_LINE_GRID_COLUMNS}
            minWidth="42rem"
            headers={[
              <span key="reorder" />,
              "Component",
              isBatch ? "Qty / Batch" : "Qty",
              "Min Age",
              "Unit",
              <span key="actions" />,
            ]}
          >
            {fields.map((field, index) => (
              <BomRow
                key={field.id}
                lineKey={field.id}
                index={index}
                control={control}
                componentOptions={componentOptions}
                componentMap={componentMap}
                onRemove={() => remove(index)}
              />
            ))}
          </EditableLineGrid>
        </SortableReorder>
      ) : (
        <div className="rounded-lg border border-dashed px-4 py-6">
          <p className="text-sm text-muted-foreground">
            {isBatch
              ? "Add ingredients to define what goes into one batch of this product."
              : "Add ingredients to define what goes into one unit of this product."}
          </p>
        </div>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() =>
          append({
            componentId: "",
            quantity: null,
            minimumLotAgeDays: null,
            alternates: [],
          })
        }
      >
        + Add Ingredient
      </Button>
    </div>
  );
}

/** Extracted sub-component so useWatch can be called at the top level (Rules of Hooks). */
function BomRow({
  lineKey,
  index,
  control,
  componentOptions,
  componentMap,
  onRemove,
}: {
  lineKey: string;
  index: number;
  control: Control<ItemFormValues>;
  componentOptions: Array<AvailableComponent & { unitName: string }>;
  componentMap: Map<string, AvailableComponent>;
  onRemove: () => void;
}) {
  const componentId = useWatch({ control, name: `bom.${index}.componentId` });
  const selectedComponent = componentMap.get(componentId ?? "");
  const { attributes, listeners, setNodeRef, style } =
    useSortableReorderItem(lineKey);

  return (
    <EditableLineGridRow ref={setNodeRef} data-testid="bom-row" style={style}>
      <EditableLineGridCell align="center">
        <SortableDragHandle
          attributes={attributes}
          listeners={listeners}
          label={`Reorder ingredient ${index + 1}`}
        />
      </EditableLineGridCell>
      <EditableLineGridCell>
        <Controller
          name={`bom.${index}.componentId`}
          control={control}
          render={({ field: f, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel className="sr-only" htmlFor={`${lineKey}-component`}>
                Component
              </FieldLabel>
              <InventoryItemCombobox
                options={componentOptions}
                value={f.value ?? ""}
                onValueChange={(id) => f.onChange(id ?? "")}
                inputId={`${lineKey}-component`}
                inputAriaInvalid={fieldState.invalid}
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
              <FieldLabel className="sr-only" htmlFor={`${lineKey}-quantity`}>
                Quantity
              </FieldLabel>
              <Input
                {...f}
                id={`${lineKey}-quantity`}
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
              <FieldLabel className="sr-only" htmlFor={`${lineKey}-min-age`}>
                Min Age
              </FieldLabel>
              <Input
                {...f}
                id={`${lineKey}-min-age`}
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
      <EditableLineGridCell>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onRemove}
          className="text-muted-foreground"
        >
          <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
        </Button>
      </EditableLineGridCell>
    </EditableLineGridRow>
  );
}
