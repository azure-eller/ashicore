import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type ProviderIconFrameTone = "primary" | "muted";

const toneClass: Record<ProviderIconFrameTone, string> = {
  muted: "border bg-muted text-foreground",
  primary: "bg-primary text-primary-foreground",
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
        "flex size-(--space-20) shrink-0 items-center justify-center text-[length:var(--text-sm)] font-semibold shadow-none",
        toneClass[tone],
        className,
      )}
    >
      {children}
    </div>
  );
}
