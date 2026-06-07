"use client";

import { useId, type ReactNode } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import styles from "./card-page.module.css";

export function CardField({
  label,
  htmlFor,
  required,
  invalid,
  error,
  controlStyle = "card",
  children,
  className,
}: {
  label: ReactNode;
  htmlFor?: string;
  required?: boolean;
  invalid?: boolean;
  error?: ReactNode;
  controlStyle?: "card" | "dialog";
  children: ReactNode;
  className?: string;
}) {
  const labelClassName =
    controlStyle === "dialog"
      ? cn(
          "text-[length:var(--text-sm)] leading-[var(--leading-sm)] font-medium text-[var(--color-ink)]",
          invalid && "text-[var(--status-danger-ink)]",
        )
      : cn(styles.formLabel, invalid && styles.formLabelInvalid);

  return (
    <Field data-invalid={invalid || undefined} className={cn(styles.formField, className)}>
      <FieldLabel htmlFor={htmlFor} className={labelClassName}>
        {label}
        {required ? <span className={styles.requiredMark}> *</span> : null}
      </FieldLabel>
      {children}
      {error ? <FieldError>{error}</FieldError> : null}
    </Field>
  );
}

export function CardReadOnlyValue({
  children,
  mono,
  title,
  className,
}: {
  children: ReactNode;
  mono?: boolean;
  title?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(styles.readOnlyFieldValue, mono && styles.mono, className)}
      title={title}
    >
      {children}
    </div>
  );
}

type CardTextFieldProps = Omit<React.ComponentProps<typeof Input>, "className" | "value"> & {
  label: ReactNode;
  value: string | number | null | undefined;
  error?: ReactNode;
  invalid?: boolean;
  controlStyle?: "card" | "dialog";
  className?: string;
  inputClassName?: string;
};

export function CardTextField({
  label,
  value,
  required,
  invalid,
  error,
  controlStyle = "card",
  className,
  inputClassName,
  ...inputProps
}: CardTextFieldProps) {
  const generatedId = useId();
  const id = inputProps.id ?? generatedId;
  const controlClassName =
    controlStyle === "card"
      ? cn(styles.underlineControl, invalid && styles.invalidControl, inputClassName)
      : inputClassName;

  return (
    <CardField
      label={label}
      htmlFor={id}
      required={required}
      invalid={invalid}
      error={error}
      controlStyle={controlStyle}
      className={className}
    >
      <Input
        {...inputProps}
        id={id}
        value={value ?? ""}
        required={required}
        aria-invalid={invalid || undefined}
        className={controlClassName}
      />
    </CardField>
  );
}

export function CardNumberField(props: CardTextFieldProps) {
  return <CardTextField {...props} inputMode={props.inputMode ?? "decimal"} />;
}

export function CardSelectField({
  id,
  label,
  value,
  onValueChange,
  placeholder,
  options,
  disabled,
  required,
  invalid,
  error,
  controlStyle = "card",
  className,
  triggerClassName,
  contentClassName,
}: {
  id?: string;
  label: ReactNode;
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  options: Array<{ value: string; label: ReactNode; disabled?: boolean }>;
  disabled?: boolean;
  required?: boolean;
  invalid?: boolean;
  error?: ReactNode;
  controlStyle?: "card" | "dialog";
  className?: string;
  triggerClassName?: string;
  contentClassName?: string;
}) {
  const generatedId = useId();
  const triggerId = id ?? generatedId;
  const controlClassName =
    controlStyle === "card"
      ? cn(
          styles.underlineControl,
          invalid && styles.invalidControl,
          "w-full justify-between",
          triggerClassName,
        )
      : cn("w-full justify-between", triggerClassName);

  return (
    <CardField
      label={label}
      htmlFor={triggerId}
      required={required}
      invalid={invalid}
      error={error}
      controlStyle={controlStyle}
      className={className}
    >
      <Select value={value} onValueChange={onValueChange} disabled={disabled}>
        <SelectTrigger
          id={triggerId}
          className={controlClassName}
          aria-invalid={invalid || undefined}
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent className={contentClassName}>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </CardField>
  );
}

export function CardCheckboxField({
  label,
  checked,
  onCheckedChange,
  disabled,
  controlStyle = "card",
  className,
}: {
  label: ReactNode;
  checked: React.ComponentProps<typeof Checkbox>["checked"];
  onCheckedChange: React.ComponentProps<typeof Checkbox>["onCheckedChange"];
  disabled?: boolean;
  controlStyle?: "card" | "dialog";
  className?: string;
}) {
  return (
    <label
      className={cn(
        styles.cardCheckboxField,
        controlStyle === "dialog" && styles.cardCheckboxFieldDialog,
        className,
      )}
    >
      <Checkbox checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} />
      <span>{label}</span>
    </label>
  );
}
