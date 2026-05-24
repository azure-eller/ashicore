"use client";

import { Field, FieldLabel } from "@/components/ui/field";
import { CommitInput } from "@/components/card-page/commit-input";
import { NotesField } from "@/components/card-page/notes-field";
import { type UpdateItemCardInput } from "@/lib/api/clients/item-cards";
import styles from "./card-page.module.css";

type DraftItemCardPatch = Partial<UpdateItemCardInput>;

type ItemCardFieldProps = {
  field: keyof UpdateItemCardInput;
  label: string;
  value: string | null;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  onFamilyChange: (patch: DraftItemCardPatch, delayMs?: number) => void;
  onFamilyCommit: (patch?: DraftItemCardPatch) => void;
};

export function ItemCardCommitField({
  field,
  label,
  value,
  placeholder,
  required,
  disabled,
  autoFocus,
  onFamilyChange,
  onFamilyCommit,
}: ItemCardFieldProps) {
  return (
    <Field>
      <FieldLabel>
        {label}
        {required ? <span className={styles.requiredMark}> *</span> : null}
      </FieldLabel>
      <CommitInput
        label={label}
        autoFocus={autoFocus}
        value={value}
        required={required}
        placeholder={placeholder}
        disabled={disabled}
        commitUnchangedValue
        onDraftChange={(next) => {
          onFamilyChange({ [field]: next } as DraftItemCardPatch, Number.POSITIVE_INFINITY);
        }}
        onCommit={(next) => {
          if (next === (value ?? null)) {
            onFamilyCommit();
            return;
          }
          onFamilyCommit({ [field]: next } as DraftItemCardPatch);
        }}
      />
    </Field>
  );
}

export function ItemCardNotesField({
  field,
  label,
  value,
  disabled,
  onFamilyChange,
  onFamilyCommit,
}: Omit<ItemCardFieldProps, "placeholder" | "required" | "autoFocus">) {
  return (
    <NotesField
      label={label}
      value={value}
      disabled={disabled}
      rows={3}
      commitUnchangedValue
      onDraftChange={(next) => {
        onFamilyChange({ [field]: next } as DraftItemCardPatch, Number.POSITIVE_INFINITY);
      }}
      onCommit={(next) => {
        if (next === (value ?? null)) {
          onFamilyCommit();
          return;
        }
        onFamilyCommit({ [field]: next } as DraftItemCardPatch);
      }}
    />
  );
}
