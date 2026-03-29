"use client";

import { useMemo } from "react";
import { useFieldArray, useWatch, Controller, type Control } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import {
  FieldError,
  FieldGroup,
} from "@/components/ui/field";
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
  itemType: string;
  unit: string;
};

type ItemFormValues = InsertItemFormValues | UpdateItemFormValues;

interface BomEditorProps {
  control: Control<ItemFormValues>;
  availableComponents: AvailableComponent[];
}

export function BomEditor({ control, availableComponents }: BomEditorProps) {
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
    <FieldGroup className="gap-6">
      {fields.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Component</TableHead>
                <TableHead className="w-32">Qty</TableHead>
                <TableHead className="w-24">Unit</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
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
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed px-4 py-6">
          <p className="text-sm text-muted-foreground">
            Add ingredients to define what goes into one unit of this product.
          </p>
        </div>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() =>
          append({ componentId: "", quantity: null })
        }
      >
        + Add Ingredient
      </Button>
    </FieldGroup>
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

  return (
    <TableRow>
      <TableCell>
        <Controller
          name={`bom.${index}.componentId`}
          control={control}
          render={({ field: f, fieldState }) => (
            <div>
              <Combobox
                items={componentIds}
                value={f.value ?? ""}
                onValueChange={(id) => f.onChange(id ?? "")}
                itemToStringLabel={(id) => componentMap.get(id)?.name ?? ""}
              >
                <ComboboxInput placeholder="Search items..." />
                <ComboboxContent>
                  <ComboboxEmpty>No items found</ComboboxEmpty>
                  <ComboboxList>
                    {(id: string) => {
                      const comp = componentMap.get(id);
                      return (
                        <ComboboxItem key={id} value={id}>
                          <span>{comp?.name ?? id}</span>
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
      </TableCell>
      <TableCell>
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
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {selectedComponent?.unit ?? "\u2014"}
      </TableCell>
      <TableCell>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onRemove}
          className="text-muted-foreground"
        >
          <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
        </Button>
      </TableCell>
    </TableRow>
  );
}
