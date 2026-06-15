import type { ReactNode } from "react";

import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import styles from "./card-page.module.css";

export function CardPage({
  children,
  className,
  framed = false,
}: {
  children: ReactNode;
  className?: string;
  framed?: boolean;
}) {
  if (framed) {
    return (
      <div className={styles.pageFrame}>
        <div data-slot="card-page-sheet" className={cn(styles.sheet, className)}>{children}</div>
      </div>
    );
  }

  return <div data-slot="card-page-sheet" className={cn(styles.sheet, className)}>{children}</div>;
}

export function CardPageBody({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <ScrollArea
      data-slot="card-page-body"
      className={cn(styles.body, className)}
      viewportClassName={styles.bodyViewport}
    >
      {children}
    </ScrollArea>
  );
}

export function CardPageBanner({
  children,
  tone = "destructive",
  className,
}: {
  children: ReactNode;
  tone?: "destructive";
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "border-b border-[var(--color-line)] bg-[var(--color-danger-soft)] px-(--space-5) py-(--space-3) text-[length:var(--text-sm)] text-[var(--status-danger-ink)]",
        tone === "destructive" && "text-[var(--status-danger-ink)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardSection({
  title,
  count,
  hint,
  actions,
  children,
  className,
  "aria-label": ariaLabel,
}: {
  title?: ReactNode;
  count?: ReactNode;
  hint?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <section className={cn(styles.section, className)} aria-label={ariaLabel}>
      {title || count != null || hint || actions ? (
        <div className={styles.sectionHeader}>
          {title ? (
            <h2 className={styles.sectionHeading}>
              {title}
              {count != null ? <span className={styles.count}>{count}</span> : null}
            </h2>
          ) : null}
          {hint ? <span className={styles.hint}>{hint}</span> : null}
          {actions ? <div className={styles.sectionActions}>{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}
