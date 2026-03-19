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
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  Field,
} from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import type { InsertItem, UpdateItem } from "@/lib/schemas/items";

type AvailableComponent = {
  id: string;
  name: string;
  itemType: string;
  unit: string;
};

interface BomEditorProps {
  control: Control<InsertItem | UpdateItem>;
  availableComponents: AvailableComponent[];
}

export function BomEditor({ control, availableComponents }: BomEditorProps) {
  const { fields, append, remove } = useFieldArray({
    control,
    name: "bom",
  });

  const bomMode = useWatch({ control, name: "bomMode" }) ?? "quantity";

  const componentIds = useMemo(
    () => availableComponents.map((c) => c.id),
    [availableComponents]
  );

  const componentMap = useMemo(
    () => new Map(availableComponents.map((c) => [c.id, c])),
    [availableComponents]
  );

  return (
    <FieldSet>
      <FieldLegend>Recipe / Bill of Materials</FieldLegend>
      <FieldDescription>
        Ingredients needed to produce one unit of this product.
      </FieldDescription>
      <FieldGroup>
        <Controller
          name="bomMode"
          control={control}
          render={({ field }) => (
            <Field>
              <FieldLabel htmlFor={field.name}>Mode</FieldLabel>
              <Select
                name={field.name}
                value={field.value ?? "quantity"}
                onValueChange={field.onChange}
              >
                <SelectTrigger id={field.name} className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="quantity">Quantity per unit</SelectItem>
                  <SelectItem value="percentage">Percentage</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          )}
        />

        {fields.length > 0 && (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Component</TableHead>
                  <TableHead className="w-32">
                    {bomMode === "percentage" ? "%" : "Qty"}
                  </TableHead>
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
                    bomMode={bomMode}
                    componentIds={componentIds}
                    componentMap={componentMap}
                    onRemove={() => remove(index)}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {bomMode === "percentage" && fields.length > 0 && (
          <PercentageTotal control={control} />
        )}

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            append({ componentId: "", quantity: null, percentage: null })
          }
        >
          + Add Ingredient
        </Button>
      </FieldGroup>
    </FieldSet>
  );
}

/** Extracted sub-component so useWatch can be called at the top level (Rules of Hooks). */
function BomRow({
  index,
  control,
  bomMode,
  componentIds,
  componentMap,
  onRemove,
}: {
  index: number;
  control: Control<InsertItem | UpdateItem>;
  bomMode: string;
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
          render={({ field: f }) => (
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
          )}
        />
      </TableCell>
      <TableCell>
        <Controller
          name={
            bomMode === "percentage"
              ? `bom.${index}.percentage`
              : `bom.${index}.quantity`
          }
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

function PercentageTotal({ control }: { control: Control<InsertItem | UpdateItem> }) {
  const bom = useWatch({ control, name: "bom" });
  const total = (bom ?? []).reduce((sum, row) => {
    const val = parseFloat(row?.percentage ?? "0");
    return sum + (isNaN(val) ? 0 : val);
  }, 0);

  return (
    <p className={`text-sm ${Math.abs(total - 100) < 0.01 ? "text-muted-foreground" : "text-destructive"}`}>
      Total: {total.toFixed(1)}%
      {Math.abs(total - 100) >= 0.01 && " (should be 100%)"}
    </p>
  );
}
