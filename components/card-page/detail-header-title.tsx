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
        <span className="ml-[10px] font-sans text-[14px] font-semibold text-[var(--color-ink)]">
          {name}
        </span>
      ) : null}
      {subId ? (
        <span
          className={cn(
            styles.mono,
            "ml-2 text-[14px] font-medium text-[var(--color-muted)]",
          )}
        >
          / {subId}
        </span>
      ) : null}
    </span>
  );
}
