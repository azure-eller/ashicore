"use client";

import {
  useCallback,
  useEffect,
  type FocusEventHandler,
  type ReactNode,
} from "react";
import {
  useFieldArray,
  useWatch,
  type Control,
  type FieldArray,
  type FieldArrayPath,
  type FieldArrayWithId,
  type FieldValues,
} from "react-hook-form";

import { FieldError } from "@/components/ui/field";
import { SortableReorder } from "@/components/sortable-reorder";
import { EditableLineGrid } from "@/components/editable-line-grid";

export type EditableLineItemRowProps = {
  onFocusCapture?: FocusEventHandler<HTMLElement>;
};

type RenderRowContext<
  TValues extends FieldValues,
  TName extends FieldArrayPath<TValues>,
> = {
  field: FieldArrayWithId<TValues, TName>;
  index: number;
  isTrailingBlank: boolean;
  rowProps: EditableLineItemRowProps;
  remove: () => void;
};

export function EditableLineItems<
  TValues extends FieldValues,
  TName extends FieldArrayPath<TValues>,
>({
  control,
  name,
  columns,
  headers,
  blankLine,
  isBlankLine,
  renderRow,
  minWidth,
  error,
  footer,
  enableReorder = true,
}: {
  control: Control<TValues>;
  name: TName;
  columns: string;
  headers: ReactNode[];
  blankLine: FieldArray<TValues, TName>;
  isBlankLine: (line: FieldArray<TValues, TName> | undefined) => boolean;
  renderRow: (context: RenderRowContext<TValues, TName>) => ReactNode;
  minWidth?: string;
  error?: string | null;
  footer?: ReactNode;
  enableReorder?: boolean;
}) {
  const { fields, append, remove, move } = useFieldArray({
    control,
    name,
  });
  const watchedRows = useWatch({ control, name: name as never }) as
    | FieldArray<TValues, TName>[]
    | undefined;

  const appendBlankLine = useCallback((shouldFocus = true) => {
    append(blankLine, { shouldFocus });
  }, [append, blankLine]);

  useEffect(() => {
    const rows = watchedRows ?? [];
    if (fields.length !== rows.length) {
      return;
    }

    if (
      fields.length > 0 &&
      (rows.length === 0 || isBlankLine(rows[rows.length - 1]))
    ) {
      return;
    }

    appendBlankLine(false);
  }, [appendBlankLine, fields.length, isBlankLine, watchedRows]);

  const appendAfterTrailingBlank = useCallback(() => {
    const rows = watchedRows ?? [];
    if (fields.length !== rows.length) {
      return;
    }

    if (fields.length === 0 || !isBlankLine(rows[rows.length - 1])) {
      return;
    }

    appendBlankLine(false);
  }, [appendBlankLine, fields.length, isBlankLine, watchedRows]);

  const grid = (
    <EditableLineGrid columns={columns} minWidth={minWidth} headers={headers}>
      {fields.map((field, index) => {
        const isTrailingBlank =
          index === fields.length - 1 && isBlankLine(watchedRows?.[index]);
        const rowProps = isTrailingBlank
          ? {
              onFocusCapture: appendAfterTrailingBlank,
            }
          : {};

        return renderRow({
          field,
          index,
          isTrailingBlank,
          rowProps,
          remove: () => remove(index),
        });
      })}
    </EditableLineGrid>
  );

  return (
    <div className="flex flex-col gap-4">
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

      {footer ? (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-end">
          {footer}
        </div>
      ) : null}
    </div>
  );
}
