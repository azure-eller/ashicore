import type { ReactNode } from "react";

import styles from "./card-page.module.css";

export function CardMetaStrip({ children }: { children: ReactNode[] }) {
  const items = children.filter(Boolean);
  if (items.length === 0) return null;

  return (
    <>
      {items.map((item, index) => (
        <span key={index} className="inline-flex items-center gap-(--space-2)">
          {index > 0 ? <span className={styles.metaDot} /> : null}
          {item}
        </span>
      ))}
    </>
  );
}

export function CardMetaValue({
  label,
  value,
  mono,
}: {
  label: ReactNode;
  value: ReactNode;
  mono?: boolean;
}) {
  return (
    <span>
      {label}{" "}
      <span className={mono ? styles.mono : undefined}>{value}</span>
    </span>
  );
}
