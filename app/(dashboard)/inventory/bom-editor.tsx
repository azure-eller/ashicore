"use client";

import { useId, useMemo } from "react";
import { useWatch, Controller, type Control } from "react-hook-form";
import type { UseFormSetValue } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  "minmax(14rem, 1.4fr) minmax(6rem, 0.6fr) minmax(8rem, 0.7fr) minmax(7rem, 0.6fr) minmax(8rem, 0.7fr) minmax(6rem, 0.55fr) minmax(5.5rem, 0.45fr)";

const blankBomLine = {
  componentId: "",
  quantity: null,
  consumptionMode: "per_output_unit" as const,
  basisOutputQuantity: null,
  batchScalingMode: null,
  groupRemainderPolicy: null,
  minimumLotAgeDays: null,
  alternates: [],
};

interface BomEditorProps {
  control: Control<ItemFormValues>;
  setValue: UseFormSetValue<ItemFormValues>;
  availableComponents: AvailableComponent[];
  typicalBatchSize?: string | null;
  typicalGroupSize?: string | null;
}

export function BomEditor({
  control,
  setValue,
  availableComponents,
  typicalBatchSize,
  typicalGroupSize,
}: BomEditorProps) {
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
        minWidth="66rem"
        createLine={() => ({ ...blankBomLine, alternates: [] })}
        addLabel="Add ingredient"
        emptyMessage="No ingredients yet."
        headers={[
          "Component",
          "Qty used",
          "Used per",
          "Basis",
          "Scaling / leftovers",
          "Min Age",
          "Unit",
        ]}
        renderRow={({ field, index, appendLineAfterCommit }) => (
          <BomRow
            key={field.id}
            index={index}
            control={control}
            setValue={setValue}
            componentOptions={componentOptions}
            componentMap={componentMap}
            typicalBatchSize={typicalBatchSize}
            typicalGroupSize={typicalGroupSize}
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
  setValue,
  componentOptions,
  componentMap,
  typicalBatchSize,
  typicalGroupSize,
  appendLineAfterCommit,
}: {
  index: number;
  control: Control<ItemFormValues>;
  setValue: UseFormSetValue<ItemFormValues>;
  componentOptions: Array<AvailableComponent & { unitName: string }>;
  componentMap: Map<string, AvailableComponent>;
  typicalBatchSize?: string | null;
  typicalGroupSize?: string | null;
  appendLineAfterCommit: () => void;
}) {
  const rowDomId = useId();
  const componentId = useWatch({ control, name: `bom.${index}.componentId` });
  const consumptionMode = useWatch({
    control,
    name: `bom.${index}.consumptionMode`,
  });
  const selectedComponent = componentMap.get(componentId ?? "");
  const needsBasis =
    consumptionMode === "per_batch" || consumptionMode === "per_group";

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
          name={`bom.${index}.consumptionMode`}
          control={control}
          render={({ field: f, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel className="sr-only" htmlFor={`${rowDomId}-used-per`}>
                Used per
              </FieldLabel>
              <Select
                value={f.value ?? "per_output_unit"}
                onValueChange={(value) => {
                  f.onChange(value);
                  if (value === "per_batch") {
                    setValue(
                      `bom.${index}.basisOutputQuantity`,
                      typicalBatchSize ?? null,
                      { shouldDirty: true }
                    );
                    setValue(`bom.${index}.batchScalingMode`, "proportional", {
                      shouldDirty: true,
                    });
                    setValue(`bom.${index}.groupRemainderPolicy`, null, {
                      shouldDirty: true,
                    });
                    return;
                  }

                  if (value === "per_group") {
                    setValue(
                      `bom.${index}.basisOutputQuantity`,
                      typicalGroupSize ?? null,
                      { shouldDirty: true }
                    );
                    setValue(`bom.${index}.batchScalingMode`, null, {
                      shouldDirty: true,
                    });
                    setValue(`bom.${index}.groupRemainderPolicy`, "ask", {
                      shouldDirty: true,
                    });
                    return;
                  }

                  setValue(`bom.${index}.basisOutputQuantity`, null, {
                    shouldDirty: true,
                  });
                  setValue(`bom.${index}.batchScalingMode`, null, {
                    shouldDirty: true,
                  });
                  setValue(`bom.${index}.groupRemainderPolicy`, null, {
                    shouldDirty: true,
                  });
                }}
              >
                <SelectTrigger
                  id={`${rowDomId}-used-per`}
                  aria-invalid={fieldState.invalid}
                  className="w-full min-w-0"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="per_output_unit">Output unit</SelectItem>
                  <SelectItem value="per_batch">Batch</SelectItem>
                  <SelectItem value="per_group">Group</SelectItem>
                </SelectContent>
              </Select>
              {fieldState.invalid && (
                <FieldError errors={[fieldState.error]} />
              )}
            </Field>
          )}
        />
      </EditableLineGridCell>
      <EditableLineGridCell>
        {needsBasis ? (
          <Controller
            name={`bom.${index}.basisOutputQuantity`}
            control={control}
            render={({ field: f, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel className="sr-only" htmlFor={`${rowDomId}-basis`}>
                  Basis
                </FieldLabel>
                <Input
                  {...f}
                  id={`${rowDomId}-basis`}
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
        ) : (
          <div className="flex h-8 items-center text-sm text-muted-foreground">
            &mdash;
          </div>
        )}
      </EditableLineGridCell>
      <EditableLineGridCell>
        {consumptionMode === "per_batch" ? (
          <Controller
            name={`bom.${index}.batchScalingMode`}
            control={control}
            render={({ field: f, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel className="sr-only" htmlFor={`${rowDomId}-batch-scaling`}>
                  Batch scaling
                </FieldLabel>
                <Select
                  value={f.value ?? "proportional"}
                  onValueChange={f.onChange}
                >
                  <SelectTrigger
                    id={`${rowDomId}-batch-scaling`}
                    aria-invalid={fieldState.invalid}
                    className="w-full min-w-0"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="proportional">Proportional</SelectItem>
                    <SelectItem value="full_batches_only">
                      Full batches only
                    </SelectItem>
                  </SelectContent>
                </Select>
                {fieldState.invalid && (
                  <FieldError errors={[fieldState.error]} />
                )}
              </Field>
            )}
          />
        ) : consumptionMode === "per_group" ? (
          <Controller
            name={`bom.${index}.groupRemainderPolicy`}
            control={control}
            render={({ field: f, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel className="sr-only" htmlFor={`${rowDomId}-group-leftovers`}>
                  Leftovers
                </FieldLabel>
                <Select value={f.value ?? "ask"} onValueChange={f.onChange}>
                  <SelectTrigger
                    id={`${rowDomId}-group-leftovers`}
                    aria-invalid={fieldState.invalid}
                    className="w-full min-w-0"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ask">Ask</SelectItem>
                    <SelectItem value="leave_loose">Leave loose</SelectItem>
                    <SelectItem value="create_partial_group">
                      Create partial group
                    </SelectItem>
                  </SelectContent>
                </Select>
                {fieldState.invalid && (
                  <FieldError errors={[fieldState.error]} />
                )}
              </Field>
            )}
          />
        ) : (
          <div className="flex h-8 items-center text-sm text-muted-foreground">
            &mdash;
          </div>
        )}
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
