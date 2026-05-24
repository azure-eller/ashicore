import type { ReactNode } from "react";

import styles from "./card-page.module.css";

export type TotalsSummaryRow = {
  label: ReactNode;
  value: ReactNode;
  minusPrefix?: boolean;
  rule?: boolean;
  emphasis?: "total" | "success";
  subValue?: ReactNode;
};

export function TotalsSummary({
  rows,
  className,
}: {
  rows: TotalsSummaryRow[];
  className?: string;
}) {
  return (
    <div className={className ?? styles.totalsSummary}>
      {rows.map((row, index) => (
        <div
          key={index}
          className={[
            styles.totalsSummaryRow,
            row.rule ? styles.totalsSummaryRule : "",
          ].join(" ")}
        >
          <div className={styles.totalsSummaryLabel}>{row.label}</div>
          <div
            className={[
              styles.totalsSummaryValue,
              row.emphasis === "total" ? styles.totalsSummaryTotal : "",
              row.emphasis === "success" ? styles.totalsSummarySuccess : "",
            ].join(" ")}
          >
            {row.minusPrefix && row.value !== "—" ? (
              <span className={styles.totalsSummaryMinusPrefix}>-</span>
            ) : null}
            {row.value}
            {row.subValue ? (
              <span className={styles.totalsSummarySubValue}>{row.subValue}</span>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
