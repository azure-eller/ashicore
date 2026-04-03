import { type VariantProps } from "class-variance-authority";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type DisabledTooltipButtonProps = {
  label: string;
  tooltip: string;
  className?: string;
} & VariantProps<typeof buttonVariants>;

export function DisabledTooltipButton({
  label,
  tooltip,
  variant,
  size = "sm",
  className,
}: DisabledTooltipButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="button"
          aria-disabled="true"
          data-disabled-reason={tooltip}
          tabIndex={0}
          title={tooltip}
          className={cn(
            buttonVariants({ variant, size }),
            "cursor-not-allowed opacity-50",
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
