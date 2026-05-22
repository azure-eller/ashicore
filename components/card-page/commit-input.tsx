"use client";

import type { HTMLAttributes } from "react";
import { useEffect, useId, useState } from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import styles from "./card-page.module.css";

export function CommitInput({
  label,
  type,
  value,
  disabled,
  required,
  autoFocus,
  inputMode,
  placeholder,
  className,
  onDraftChange,
  commitUnchangedValue,
  onCommit,
}: {
  label: string;
  type?: string;
  value: string | null | undefined;
  disabled?: boolean;
  required?: boolean;
  autoFocus?: boolean;
  inputMode?: HTMLAttributes<HTMLInputElement>["inputMode"];
  placeholder?: string;
  className?: string;
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

  return (
    <Input
      id={id}
      type={type}
      inputMode={inputMode}
      aria-label={label}
      className={cn(styles.underlineControl, className)}
      value={draft}
      autoFocus={autoFocus}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(event) => {
        setDraft(event.target.value);
        onDraftChange?.(event.target.value);
      }}
      onBlur={() => {
        const next = draft.trim() || null;
        if (required && next == null) {
          setDraft(normalizedValue);
          return;
        }
        if (!commitUnchangedValue && next === (normalizedValue || null)) return;
        onCommit(next);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
    />
  );
}
