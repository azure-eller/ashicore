import { Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

export function GridEmptyOverlay({ message }: { message: string }) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center gap-(--space-4) px-(--space-8) text-center">
      <span className="grid size-(--space-16) place-items-center rounded-md border border-[var(--color-line)] bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)] shadow-[var(--shadow-sticky)]">
        <HugeiconsIcon icon={Search01Icon} size={18} strokeWidth={2} aria-hidden />
      </span>
      <span className="max-w-sm font-display text-[length:var(--text-sm)] font-medium leading-[var(--leading-sm)] text-[var(--color-ink-soft)]">
        {message}
      </span>
    </div>
  );
}
