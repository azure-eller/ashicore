import type { ReactNode } from "react";
import styles from "./card-page.module.css";

export type CardPageTwoColumnProps = {
  left: ReactNode;
  right: ReactNode;
};

/**
 * Two-column layout used by General info tabs on both Product and Material
 * cards. Stacks on small screens; symmetric 1fr/1fr on md+ to match the
 * Calm Matrix Identity-section grid (24px row × 36px col gap).
 */
export function CardPageTwoColumn({ left, right }: CardPageTwoColumnProps) {
  return (
    <div className={styles.twoColumn}>
      <div className="space-y-(--space-4)">{left}</div>
      <div className="space-y-(--space-4)">{right}</div>
    </div>
  );
}
