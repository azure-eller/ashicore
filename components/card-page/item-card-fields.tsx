"use client";

import { CommitInput } from "@/components/card-page/commit-input";
import { CardField } from "@/components/card-page/card-field";
import { NotesField } from "@/components/card-page/notes-field";
import { underlineControlClass } from "@/components/card-page/form-cell";
import { type UpdateItemCardInput } from "@/lib/api/clients/item-cards";

type DraftItemCardPatch = Partial<UpdateItemCardInput>;

type ItemCardFieldProps = {
  field: keyof UpdateItemCardInput;
  label: string;
  value: string | null;
  placeholder?: string;
  required?: boolean;
  invalid?: boolean;
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
  invalid,
  disabled,
  autoFocus,
  onFamilyChange,
  onFamilyCommit,
}: ItemCardFieldProps) {
  const inputId = `item-card-${String(field)}`;

  return (
    <CardField label={label} htmlFor={inputId} required={required} invalid={invalid}>
      <CommitInput
        id={inputId}
        label={label}
        autoFocus={autoFocus}
        value={value}
        required={required}
        placeholder={placeholder}
        disabled={disabled}
        className={underlineControlClass(invalid)}
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
    </CardField>
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
