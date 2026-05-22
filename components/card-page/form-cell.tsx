import type { ReactNode } from "react";

import cardStyles from "./card-page.module.css";

export function CellShell({
  label,
  required,
  children,
}: {
  label: ReactNode;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={cardStyles.formField}>
      <label className={cardStyles.formLabel}>
        {label}
        {required ? <span className={cardStyles.requiredMark}> *</span> : null}
      </label>
      {children}
    </div>
  );
}
