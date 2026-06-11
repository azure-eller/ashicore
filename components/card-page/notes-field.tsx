"use client";

import { useEffect, useId, useState } from "react";

import { Panel } from "@/components/panel";
import { CardField } from "@/components/card-page/card-field";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export function NotesField({
  label = "Notes",
  hideLabel,
  value,
  disabled,
  readOnlyValue,
  rows = 6,
  className,
  readOnlyClassName,
  placeholder,
  onDraftChange,
  commitUnchangedValue,
  onCommit,
}: {
  label?: string;
  hideLabel?: boolean;
  value: string | null | undefined;
  disabled?: boolean;
  readOnlyValue?: boolean;
  rows?: number;
  className?: string;
  readOnlyClassName?: string;
  placeholder?: string;
  onDraftChange?: (value: string) => void;
  commitUnchangedValue?: boolean;
  onCommit: (value: string | null) => void;
}) {
  const id = useId();
  const normalizedValue = value ?? "";
  const [draft, setDraft] = useState(normalizedValue);

  useEffect(() => {
    setDraft(normalizedValue);
  }, [normalizedValue]);

  const controlLabel = hideLabel && typeof label === "string" ? label : undefined;

  return (
    <CardField label={label} htmlFor={id} hideLabel={hideLabel}>
      {readOnlyValue ? (
        <Panel
          aria-label={controlLabel}
          className={cn(
            "min-h-36 whitespace-pre-wrap p-(--space-4) text-[length:var(--text-md)] leading-[var(--leading-md)]",
            readOnlyClassName,
          )}
        >
          {normalizedValue || "-"}
        </Panel>
      ) : (
        <Textarea
          id={id}
          aria-label={controlLabel}
          className={cn("min-h-36 text-[length:var(--text-md)] leading-[var(--leading-md)]", className)}
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
            if (!commitUnchangedValue && next === (normalizedValue || null)) return;
            onCommit(next);
          }}
        />
      )}
    </CardField>
  );
}
