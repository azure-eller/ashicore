"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  useFieldArray,
  type Control,
  type FieldArray,
  type FieldArrayPath,
  type FieldArrayWithId,
  type FieldValues,
} from "react-hook-form";
import { Add01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import {
  SortableDragHandle,
  SortableReorder,
  useSortableReorderItem,
} from "@/components/sortable-reorder";
import {
  EditableLineGrid,
  EditableLineGridCell,
  EditableLineGridRemoveButton,
  EditableLineGridRow,
} from "@/components/editable-line-grid";

type RenderRowContext<
  TValues extends FieldValues,
  TName extends FieldArrayPath<TValues>,
> = {
  field: FieldArrayWithId<TValues, TName>;
  index: number;
  initialIndex: number | null;
  appendLineAfterCommit: () => void;
};

const ACTION_COLUMN_WIDTH = "2.25rem";

export function EditableLineItems<
  TValues extends FieldValues,
  TName extends FieldArrayPath<TValues>,
>({
  control,
  name,
  columns,
  headers,
  createLine,
  addLabel,
  emptyMessage = "No rows yet.",
  renderRow,
  minWidth,
  error,
  footer,
  enableReorder = true,
  onFieldsChange,
}: {
  control: Control<TValues>;
  name: TName;
  columns: string;
  headers: ReactNode[];
  createLine: () => FieldArray<TValues, TName>;
  addLabel: string;
  emptyMessage?: string;
  renderRow: (context: RenderRowContext<TValues, TName>) => ReactNode;
  minWidth?: string;
  error?: string | null;
  footer?: ReactNode;
  enableReorder?: boolean;
  onFieldsChange?: (fields: FieldArrayWithId<TValues, TName>[]) => void;
}) {
  const { fields, append, remove, move } = useFieldArray({
    control,
    name,
  });
  const rootRef = useRef<HTMLDivElement>(null);
  const initialRowCreatedRef = useRef(false);
  const [initialFieldIds] = useState(() =>
    fields.map((field, index) => ({ id: field.id, index }))
  );
  const initialIndexByFieldId = useMemo(
    () => new Map(initialFieldIds.map((field) => [field.id, field.index])),
    [initialFieldIds]
  );
  const [appendedAfterCommitRowIds, setAppendedAfterCommitRowIds] = useState(
    () => new Set<string>()
  );
  const [focusRequest, setFocusRequest] = useState(0);

  const focusLastPrimaryControl = useCallback(() => {
    const controls = rootRef.current?.querySelectorAll<HTMLElement>(
      "[data-editable-line-primary]"
    );
    const control = controls?.[controls.length - 1];

    if (control) {
      control.focus();
    }
  }, []);

  const addLine = useCallback(() => {
    append(createLine(), { shouldFocus: false });
    setFocusRequest((current) => current + 1);
  }, [append, createLine]);

  useEffect(() => {
    if (focusRequest === 0) {
      return;
    }

    const frameId = requestAnimationFrame(focusLastPrimaryControl);
    return () => cancelAnimationFrame(frameId);
  }, [focusLastPrimaryControl, focusRequest, fields.length]);

  useEffect(() => {
    if (initialRowCreatedRef.current) {
      return;
    }

    initialRowCreatedRef.current = true;

    if (fields.length === 0) {
      initializeBlankLineWithoutDirtyingForm(control, name, createLine());
    }
  }, [control, createLine, fields.length, name]);

  useEffect(() => {
    onFieldsChange?.(fields);
  }, [fields, onFieldsChange]);

  const gridColumns = `${enableReorder ? `${ACTION_COLUMN_WIDTH} ` : ""}${columns} ${ACTION_COLUMN_WIDTH}`;
  const gridHeaders = [
    ...(enableReorder ? [<span key="reorder" />] : []),
    ...headers,
    <span key="actions" />,
  ];
  const rowTestId = `${String(name)}-row`;

  const appendLineAfterCommit = useCallback(
    (fieldId: string, index: number) => {
      if (index !== fields.length - 1) {
        return;
      }

      if (appendedAfterCommitRowIds.has(fieldId)) {
        return;
      }

      setAppendedAfterCommitRowIds((current) => new Set(current).add(fieldId));
      append(createLine(), { shouldFocus: false });
    },
    [append, appendedAfterCommitRowIds, createLine, fields.length]
  );

  const grid = (
    <EditableLineGrid columns={gridColumns} minWidth={minWidth} headers={gridHeaders}>
      {fields.length > 0 ? (
        fields.map((field, index) =>
          enableReorder ? (
            <SortableEditableLineItemRow
              key={field.id}
              id={field.id}
              index={index}
              rowTestId={rowTestId}
              onRemove={() => remove(index)}
            >
              {renderRow({
                field,
                index,
                initialIndex: initialIndexByFieldId.get(field.id) ?? null,
                appendLineAfterCommit: () =>
                  appendLineAfterCommit(field.id, index),
              })}
            </SortableEditableLineItemRow>
          ) : (
            <StaticEditableLineItemRow
              key={field.id}
              index={index}
              rowTestId={rowTestId}
              onRemove={() => remove(index)}
            >
              {renderRow({
                field,
                index,
                initialIndex: initialIndexByFieldId.get(field.id) ?? null,
                appendLineAfterCommit: () =>
                  appendLineAfterCommit(field.id, index),
              })}
            </StaticEditableLineItemRow>
          )
        )
      ) : (
        <div
          role="row"
          className="grid min-w-0 grid-cols-(--editable-line-grid-columns)"
        >
          <div
            role="cell"
            className="col-span-full px-[var(--table-cell-px)] py-8 text-center text-sm text-muted-foreground"
          >
            {emptyMessage}
          </div>
        </div>
      )}
    </EditableLineGrid>
  );

  return (
    <div ref={rootRef} className="flex flex-col gap-4">
      {enableReorder ? (
        <SortableReorder
          ids={fields.map((field) => field.id)}
          onMove={(fromIndex, toIndex) => move(fromIndex, toIndex)}
        >
          {grid}
        </SortableReorder>
      ) : (
        grid
      )}

      {error && <FieldError>{error}</FieldError>}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <Button type="button" variant="outline" onClick={addLine}>
          <HugeiconsIcon icon={Add01Icon} data-icon="inline-start" />
          {addLabel}
        </Button>

        {footer ? (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-end">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SortableEditableLineItemRow({
  id,
  index,
  rowTestId,
  children,
  onRemove,
}: {
  id: string;
  index: number;
  rowTestId: string;
  children: ReactNode;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, style } =
    useSortableReorderItem(id);

  return (
    <EditableLineGridRow ref={setNodeRef} style={style} data-testid={rowTestId}>
      <EditableLineGridCell align="center">
        <SortableDragHandle
          attributes={attributes}
          listeners={listeners}
          label={`Reorder line ${index + 1}`}
        />
      </EditableLineGridCell>
      {children}
      <EditableLineGridCell align="center">
        <EditableLineGridRemoveButton
          onClick={onRemove}
          label={`Remove line ${index + 1}`}
        />
      </EditableLineGridCell>
    </EditableLineGridRow>
  );
}

function StaticEditableLineItemRow({
  index,
  rowTestId,
  children,
  onRemove,
}: {
  index: number;
  rowTestId: string;
  children: ReactNode;
  onRemove: () => void;
}) {
  return (
    <EditableLineGridRow data-testid={rowTestId}>
      {children}
      <EditableLineGridCell align="center">
        <EditableLineGridRemoveButton
          onClick={onRemove}
          label={`Remove line ${index + 1}`}
        />
      </EditableLineGridCell>
    </EditableLineGridRow>
  );
}

function initializeBlankLineWithoutDirtyingForm<
  TValues extends FieldValues,
  TName extends FieldArrayPath<TValues>,
>(
  control: Control<TValues>,
  name: TName,
  line: FieldArray<TValues, TName>
) {
  const nextValues = cloneFieldValues(control._formValues);
  setPathValue(nextValues, String(name), [line]);
  control._reset(nextValues as TValues, {
    keepErrors: true,
    keepIsSubmitted: true,
    keepSubmitCount: true,
    keepTouched: true,
  });
}

function cloneFieldValues(value: unknown): FieldValues {
  if (Array.isArray(value)) {
    return [...value];
  }

  if (isPlainObject(value)) {
    return { ...value };
  }

  return {};
}

function setPathValue(target: FieldValues, path: string, value: unknown) {
  const segments = path.split(".");
  let cursor = target;

  segments.forEach((segment, index) => {
    if (index === segments.length - 1) {
      cursor[segment] = value;
      return;
    }

    const existingValue = cursor[segment];
    const nextSegment = segments[index + 1];
    const nextValue = Array.isArray(existingValue)
      ? [...existingValue]
      : isPlainObject(existingValue)
        ? { ...existingValue }
        : Number.isInteger(Number(nextSegment))
          ? []
          : {};

    cursor[segment] = nextValue;
    cursor = nextValue as FieldValues;
  });
}

function isPlainObject(value: unknown): value is FieldValues {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  );
}
