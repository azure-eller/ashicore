"use client";

import { useEffect, useId, useState } from "react";

import { Field, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export function NotesField({
  label = "Notes",
  value,
  disabled,
  readOnlyValue,
  rows = 6,
  className,
  readOnlyClassName,
  placeholder,
  onDraftChange,
  onCommit,
}: {
  label?: string;
  value: string | null | undefined;
  disabled?: boolean;
  readOnlyValue?: boolean;
  rows?: number;
  className?: string;
  readOnlyClassName?: string;
  placeholder?: string;
  onDraftChange?: (value: string) => void;
  onCommit: (value: string | null) => void;
}) {
  const id = useId();
  const normalizedValue = value ?? "";
  const [draft, setDraft] = useState(normalizedValue);

  useEffect(() => {
    setDraft(normalizedValue);
  }, [normalizedValue]);

  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {readOnlyValue ? (
        <div
          className={cn(
            "min-h-36 whitespace-pre-wrap border border-border p-(--space-4) text-[length:var(--text-sm)]",
            readOnlyClassName,
          )}
        >
          {normalizedValue || "-"}
        </div>
      ) : (
        <Textarea
          id={id}
          className={cn("min-h-36", className)}
          value={draft}
          disabled={disabled}
          rows={rows}
          placeholder={placeholder}
          onChange={(event) => {
            setDraft(event.target.value);
            onDraftChange?.(event.target.value);
          }}
          onBlur={() => {
            const next = draft.trim() || null;
            if (next === (normalizedValue || null)) return;
            onCommit(next);
          }}
        />
      )}
    </Field>
  );
}
