"use client";

import { createContext, useContext, type ReactNode } from "react";
import { TooltipHeader } from "@/components/tooltip-header";
import { fieldErrorAt, type FieldErrorRecord } from "@/lib/api/field-errors";
import { CardField } from "./card-field";
import { CommitInput } from "./commit-input";
import { underlineControlClass } from "./form-cell";

/**
 * Typed bound fields for card pages. A card creates one set per patch type at
 * module scope, mounts the Provider with its draft values + commit callback,
 * and each field binds by patch key — no per-field value/onCommit wiring.
 *
 *   const Fields = createCardFields<PatchSupplier>();
 *   <Fields.Provider values={display} commit={commitSupplierPatch} readOnly={readOnly} idPrefix="supplier">
 *     <Fields.Text name="paymentTerms" label="Payment terms" />
 *   </Fields.Provider>
 *
 * Field ids are `${idPrefix}-${kebab(name)}`, matching the existing handwritten
 * ids (e.g. supplier-payment-terms).
 */
export function createCardFields<TPatch extends Record<string, unknown>>() {
  type FieldName = Extract<keyof TPatch, string>;

  type ContextValue = {
    values: { [K in FieldName]?: unknown };
    commit: (patch: Partial<TPatch>) => void;
    readOnly: boolean;
    idPrefix: string;
    errors?: FieldErrorRecord | null;
  };

  const Context = createContext<ContextValue | null>(null);

  function useFields() {
    const context = useContext(Context);
    if (!context) {
      throw new Error("Card bound fields must be used inside their Provider.");
    }
    return context;
  }

  function Provider({
    values,
    commit,
    readOnly,
    idPrefix,
    errors,
    children,
  }: ContextValue & { children: ReactNode }) {
    return (
      <Context.Provider value={{ values, commit, readOnly, idPrefix, errors }}>
        {children}
      </Context.Provider>
    );
  }

  function Text({
    name,
    label,
    tooltip,
    type,
    required,
    autoFocus,
    invalid,
    placeholder,
  }: {
    name: FieldName;
    label: string;
    tooltip?: string;
    type?: string;
    required?: boolean;
    autoFocus?: boolean;
    invalid?: boolean;
    placeholder?: string;
  }) {
    const { values, commit, readOnly, idPrefix, errors } = useFields();
    const id = `${idPrefix}-${kebabCase(name)}`;
    const value = values[name];
    const fieldError = fieldErrorAt(errors, name);
    const showInvalid = invalid || fieldError != null;

    return (
      <CardField
        label={tooltip ? <TooltipHeader label={label} tooltip={tooltip} /> : label}
        htmlFor={id}
        required={required}
        invalid={showInvalid}
        error={fieldError}
      >
        <CommitInput
          id={id}
          label={label}
          type={type}
          value={value == null ? "" : String(value)}
          disabled={readOnly}
          required={required}
          autoFocus={autoFocus}
          placeholder={placeholder}
          className={underlineControlClass(showInvalid)}
          onCommit={(next) => commit({ [name]: next } as Partial<TPatch>)}
        />
      </CardField>
    );
  }

  return { Provider, Text };
}

function kebabCase(value: string) {
  return value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}
