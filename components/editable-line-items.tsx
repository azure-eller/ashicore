"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
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
import { SortableReorder } from "@/components/sortable-reorder";
import { EditableLineGrid } from "@/components/editable-line-grid";

type RenderRowContext<
  TValues extends FieldValues,
  TName extends FieldArrayPath<TValues>,
> = {
  field: FieldArrayWithId<TValues, TName>;
  index: number;
  isLastRow: boolean;
  addLine: () => void;
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
  createLine,
  addLabel,
  emptyMessage = "No rows yet.",
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
  createLine: () => FieldArray<TValues, TName>;
  addLabel: string;
  emptyMessage?: string;
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
  const rootRef = useRef<HTMLDivElement>(null);
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

  const grid = (
    <EditableLineGrid columns={columns} minWidth={minWidth} headers={headers}>
      {fields.length > 0 ? (
        fields.map((field, index) =>
          renderRow({
            field,
            index,
            isLastRow: index === fields.length - 1,
            addLine,
            remove: () => remove(index),
          })
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
