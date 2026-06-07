import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function TooltipHeader({
  label,
  tooltip,
  className,
}: {
  label: string;
  tooltip: string;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "inline-flex w-fit cursor-help items-center border-b border-dotted border-[var(--color-line)] font-mono text-[length:var(--text-3xs)] font-semibold tracking-[0.07em] text-[var(--color-ink-faint)] uppercase transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-ink)]",
            className
          )}
        >
          {label}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">{tooltip}</TooltipContent>
    </Tooltip>
  );
}
