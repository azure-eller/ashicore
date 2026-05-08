"use client";

import { useMemo } from "react";
import { useFieldArray, useWatch, Controller, type Control } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import {
  EditableLineGrid,
  EditableLineGridCell,
  EditableLineGridFullWidth,
  EditableLineGridRow,
} from "@/components/editable-line-grid";
import { Badge } from "@/components/ui/badge";
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

  const componentIds = useMemo(
    () => availableComponents.map((c) => c.id),
    [availableComponents]
  );

  const componentMap = useMemo(
    () => new Map(availableComponents.map((c) => [c.id, c])),
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
                componentIds={componentIds}
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
  componentIds,
  componentMap,
  onRemove,
}: {
  lineKey: string;
  index: number;
  control: Control<ItemFormValues>;
  componentIds: string[];
  componentMap: Map<string, AvailableComponent>;
  onRemove: () => void;
}) {
  const componentId = useWatch({ control, name: `bom.${index}.componentId` });
  const selectedComponent = componentMap.get(componentId ?? "");
  const {
    fields: alternateFields,
    append: appendAlternate,
    remove: removeAlternate,
  } = useFieldArray({
    control,
    name: `bom.${index}.alternates`,
  });
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
              <Combobox
                items={componentIds}
                value={f.value ?? ""}
                onValueChange={(id) => f.onChange(id ?? "")}
                itemToStringLabel={(id) => componentMap.get(id)?.displayName ?? ""}
              >
                <ComboboxInput
                  id={`${lineKey}-component`}
                  aria-invalid={fieldState.invalid}
                  className="w-full min-w-0"
                  placeholder="Search items..."
                />
                <ComboboxContent className="w-[min(32rem,calc(100vw-2rem))]">
                  <ComboboxEmpty>No items found</ComboboxEmpty>
                  <ComboboxList>
                    {(id: string) => {
                      const comp = componentMap.get(id);
                      return (
                        <ComboboxItem key={id} value={id}>
                          <span>{comp?.displayName ?? comp?.name ?? id}</span>
                          {comp && (
                            <Badge variant="outline" className="ml-auto text-xs">
                              {comp.itemType}
                            </Badge>
                          )}
                        </ComboboxItem>
                      );
                    }}
                  </ComboboxList>
                </ComboboxContent>
              </Combobox>
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
      <EditableLineGridFullWidth className="flex flex-col gap-2 px-[var(--table-cell-px)] pb-[var(--table-cell-py)]">
        {alternateFields.length > 0 && (
          <div className="flex flex-col gap-2 rounded-md bg-muted/40 p-2">
            {alternateFields.map((alternateField, alternateIndex) => (
              <BomAlternateRow
                key={alternateField.id}
                rowIndex={index}
                alternateIndex={alternateIndex}
                control={control}
                componentIds={componentIds}
                componentMap={componentMap}
                selectedComponentId={componentId ?? ""}
                onRemove={() => removeAlternate(alternateIndex)}
              />
            ))}
          </div>
        )}
        <div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => appendAlternate({ itemId: "" })}
          >
            + Alternate
          </Button>
        </div>
      </EditableLineGridFullWidth>
    </EditableLineGridRow>
  );
}

function BomAlternateRow({
  rowIndex,
  alternateIndex,
  control,
  componentIds,
  componentMap,
  selectedComponentId,
  onRemove,
}: {
  rowIndex: number;
  alternateIndex: number;
  control: Control<ItemFormValues>;
  componentIds: string[];
  componentMap: Map<string, AvailableComponent>;
  selectedComponentId: string;
  onRemove: () => void;
}) {
  const alternateItemId = useWatch({
    control,
    name: `bom.${rowIndex}.alternates.${alternateIndex}.itemId`,
  });
  const alternateItem = componentMap.get(alternateItemId ?? "");
  const selectableIds = useMemo(
    () => componentIds.filter((id) => id !== selectedComponentId),
    [componentIds, selectedComponentId]
  );

  return (
    <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_6rem_2.5rem] md:items-start">
      <Controller
        name={`bom.${rowIndex}.alternates.${alternateIndex}.itemId`}
        control={control}
        render={({ field: f, fieldState }) => (
          <Field data-invalid={fieldState.invalid}>
            <FieldLabel
              className="sr-only"
              htmlFor={`bom-${rowIndex}-alternate-${alternateIndex}`}
            >
              Alternate item
            </FieldLabel>
            <Combobox
              items={selectableIds}
              value={f.value ?? ""}
              onValueChange={(id) => f.onChange(id ?? "")}
              itemToStringLabel={(id) => componentMap.get(id)?.displayName ?? ""}
            >
              <ComboboxInput
                id={`bom-${rowIndex}-alternate-${alternateIndex}`}
                aria-invalid={fieldState.invalid}
                className="w-full min-w-0"
                placeholder="Alternate item..."
              />
              <ComboboxContent className="w-[min(32rem,calc(100vw-2rem))]">
                <ComboboxEmpty>No items found</ComboboxEmpty>
                <ComboboxList>
                  {(id: string) => {
                    const comp = componentMap.get(id);
                    return (
                      <ComboboxItem key={id} value={id}>
                        <span>{comp?.displayName ?? comp?.name ?? id}</span>
                        {comp && (
                          <Badge variant="secondary" className="ml-auto text-xs">
                            {comp.itemType}
                          </Badge>
                        )}
                      </ComboboxItem>
                    );
                  }}
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
            {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
          </Field>
        )}
      />
      <div className="flex h-8 items-center text-sm text-muted-foreground">
        {alternateItem?.unit ?? "\u2014"}
      </div>
      <div className="flex justify-end">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onRemove}
          className="text-muted-foreground"
        >
          <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
        </Button>
      </div>
    </div>
  );
}
