"use client";

import type { CSSProperties, ReactNode } from "react";

import { cn } from "@/lib/utils";
import styles from "./card-page.module.css";

export function CardDetailsGrid({
  columns = 3,
  children,
  className,
}: {
  columns?: 2 | 3 | 4;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(styles.detailsGrid, className)}
      style={{ "--card-details-columns": columns } as CSSProperties}
    >
      {children}
    </div>
  );
}

export function CardDetailsCell({
  label,
  span = 1,
  editable,
  children,
  className,
}: {
  label: ReactNode;
  span?: 1 | 2 | 3 | 4;
  editable?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(styles.detailsCell, editable && styles.detailsCellEditable, className)}
      style={{ gridColumn: span > 1 ? `span ${span}` : undefined }}
    >
      <div className={styles.detailsCellLabel}>{label}</div>
      {children}
    </div>
  );
}
