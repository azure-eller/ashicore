import { cn } from "@/lib/utils";
import styles from "./card-page.module.css";

export function DetailHeaderTitle({
  recordNumber,
  name,
  subId,
}: {
  recordNumber: string;
  name?: string | null;
  subId?: string | null;
}) {
  return (
    <span className={styles.mono}>
      {recordNumber}
      {name ? (
        <span className="ml-(--space-6) font-[var(--font-body)] text-[length:var(--text-base)] font-medium text-[var(--color-ink-2)]">
          {name}
        </span>
      ) : null}
      {subId ? (
        <span
          className={cn(
            styles.mono,
            "ml-2 text-[length:var(--text-sm)] font-medium text-[var(--color-muted)]",
          )}
        >
          / {subId}
        </span>
      ) : null}
    </span>
  );
}
