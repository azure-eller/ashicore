"use client";

import type { CSSProperties, ReactNode } from "react";

import { cn } from "@/lib/utils";
import styles from "./editable-info-grid.module.css";

export type EditableInfoGridField = {
  id: string;
  label: string;
  editable?: boolean;
  className?: string;
  renderEditor?: () => ReactNode;
  renderValue?: () => ReactNode;
};

export type EditableInfoGridProps = {
  fields: EditableInfoGridField[];
  columns?: number;
  className?: string;
};

export function EditableInfoGrid({
  fields,
  columns = 3,
  className,
}: EditableInfoGridProps) {
  return (
    <div
      className={cn(styles.root, className)}
      style={{ "--editable-info-grid-columns": columns } as CSSProperties}
    >
      {fields.map((field) => (
        <div
          key={field.id}
          className={cn(
            styles.cell,
            field.editable && styles.cellEditable,
            field.className
          )}
        >
          <div className={styles.label}>{field.label}</div>
          {field.renderEditor ? (
            field.renderEditor()
          ) : (
            <span className={styles.value}>{field.renderValue?.() ?? "-"}</span>
          )}
        </div>
      ))}
    </div>
  );
}
