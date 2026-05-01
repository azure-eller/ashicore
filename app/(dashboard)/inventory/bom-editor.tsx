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
import { FieldError } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
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

interface BomEditorProps {
  control: Control<ItemFormValues>;
  availableComponents: AvailableComponent[];
  manufacturingMode?: string;
}

export function BomEditor({ control, availableComponents, manufacturingMode = "discrete" }: BomEditorProps) {
  const isBatch = manufacturingMode === "batch";
  const { fields, append, remove } = useFieldArray({
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
        <div className="space-y-3 rounded-lg border p-3">
          <div className="hidden grid-cols-[minmax(0,1fr)_8rem_7rem_6rem_2.5rem] gap-3 px-2 text-xs font-medium text-muted-foreground md:grid">
            <span>Component</span>
            <span>{isBatch ? "Qty / Batch" : "Qty"}</span>
            <span>Min Age</span>
            <span>Unit</span>
            <span />
          </div>
          <div className="space-y-3">
            {fields.map((field, index) => (
              <BomRow
                key={field.id}
                index={index}
                control={control}
                componentIds={componentIds}
                componentMap={componentMap}
                onRemove={() => remove(index)}
              />
            ))}
          </div>
        </div>
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
  index,
  control,
  componentIds,
  componentMap,
  onRemove,
}: {
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

  return (
    <div
      data-testid="bom-row"
      className="grid gap-3 rounded-lg border border-dashed p-3 md:grid-cols-[minmax(0,1fr)_8rem_7rem_6rem_2.5rem] md:items-start"
    >
      <div className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground md:hidden">Component</p>
        <Controller
          name={`bom.${index}.componentId`}
          control={control}
          render={({ field: f, fieldState }) => (
            <div>
              <Combobox
                items={componentIds}
                value={f.value ?? ""}
                onValueChange={(id) => f.onChange(id ?? "")}
                itemToStringLabel={(id) => componentMap.get(id)?.displayName ?? ""}
              >
                <ComboboxInput className="w-full" placeholder="Search items..." />
                <ComboboxContent>
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
            </div>
          )}
        />
      </div>
      <div className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground md:hidden">Qty</p>
        <Controller
          name={`bom.${index}.quantity`}
          control={control}
          render={({ field: f, fieldState }) => (
            <div>
              <Input
                {...f}
                value={f.value ?? ""}
                aria-invalid={fieldState.invalid}
                placeholder="0"
                inputMode="decimal"
                autoComplete="off"
                className="w-full"
              />
              {fieldState.invalid && (
                <FieldError errors={[fieldState.error]} />
              )}
            </div>
          )}
        />
      </div>
      <div className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground md:hidden">
          Min Age
        </p>
        <Controller
          name={`bom.${index}.minimumLotAgeDays`}
          control={control}
          render={({ field: f, fieldState }) => (
            <div>
              <Input
                {...f}
                value={f.value ?? ""}
                aria-invalid={fieldState.invalid}
                placeholder="0"
                inputMode="numeric"
                autoComplete="off"
                className="w-full"
              />
              {fieldState.invalid && (
                <FieldError errors={[fieldState.error]} />
              )}
            </div>
          )}
        />
      </div>
      <div className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground md:hidden">Unit</p>
        <div className="flex h-8 items-center text-sm text-muted-foreground">
          {selectedComponent?.unit ?? "\u2014"}
        </div>
      </div>
      <div className="flex items-start justify-end md:pt-0">
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
      <div className="flex flex-col gap-2 md:col-span-5">
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
      </div>
    </div>
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
          <div>
            <Combobox
              items={selectableIds}
              value={f.value ?? ""}
              onValueChange={(id) => f.onChange(id ?? "")}
              itemToStringLabel={(id) => componentMap.get(id)?.displayName ?? ""}
            >
              <ComboboxInput className="w-full" placeholder="Alternate item..." />
              <ComboboxContent>
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
          </div>
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
