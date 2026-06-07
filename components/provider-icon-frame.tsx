import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type ProviderIconFrameTone = "primary" | "muted";

const toneClass: Record<ProviderIconFrameTone, string> = {
  muted: "border border-[var(--color-line)] bg-[var(--color-surface-alt)] text-[var(--color-ink-soft)]",
  primary: "border border-[var(--color-line)] bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)]",
};

export function ProviderIconFrame({
  children,
  tone = "muted",
  className,
}: {
  children: ReactNode;
  tone?: ProviderIconFrameTone;
  className?: string;
}) {
  return (
    <div
      aria-hidden
      className={cn(
        "flex size-(--space-20) shrink-0 items-center justify-center font-mono text-[length:var(--text-xs)] font-semibold tracking-[var(--tracking-caps)] shadow-none",
        "rounded-[var(--radius-md)]",
        toneClass[tone],
        className,
      )}
    >
      {children}
    </div>
  );
}
