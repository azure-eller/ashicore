import type { ReactNode } from "react";

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
    <div className="grid md:grid-cols-2" style={{ rowGap: 24, columnGap: 36 }}>
      <div className="space-y-(--space-4)">{left}</div>
      <div className="space-y-(--space-4)">{right}</div>
    </div>
  );
}
