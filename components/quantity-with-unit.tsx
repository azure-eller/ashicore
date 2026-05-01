"use client";

import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatCompactUnitLabel, formatQuantity } from "@/lib/format";
import { cn } from "@/lib/utils";

type QuantityValue = string | number | null | undefined;

type QuantityWithUnitProps = {
  value: QuantityValue;
  unitName?: string | null;
  unitSize?: string | null;
  unitUom?: string | null;
  label?: string;
  suffix?: string;
  muted?: boolean;
  tone?: "default" | "destructive";
  className?: string;
  valueClassName?: string;
  unitClassName?: string;
};

function formatQuantityValue(value: QuantityValue) {
  if (value == null) return formatQuantity(null);
  return formatQuantity(String(value));
}

export function QuantityWithUnit({
  value,
  unitName,
  unitSize,
  unitUom,
  label,
  suffix,
  muted = false,
  tone = "default",
  className,
  valueClassName,
  unitClassName,
}: QuantityWithUnitProps) {
  const quantity = formatQuantityValue(value);
  const compactUnit = formatCompactUnitLabel({
    name: unitName,
    size: unitSize,
    uom: unitUom,
  });
  const fullUnit = unitName?.trim() || compactUnit;
  const tooltip = [quantity, fullUnit, suffix].filter(Boolean).join(" ");

  return (
    <span
      className={cn(
        "inline-flex min-w-0 max-w-full flex-wrap items-center gap-1 align-baseline",
        muted && "text-muted-foreground",
        className
      )}
    >
      {label ? <span className="shrink-0">{label}</span> : null}
      <span
        className={cn(
          "shrink-0 font-mono tabular-nums",
          muted && "text-muted-foreground",
          tone === "destructive" && "text-destructive",
          valueClassName
        )}
      >
        {quantity}
      </span>
      {compactUnit ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge
              variant={tone === "destructive" ? "destructive" : "secondary"}
              className={cn("min-w-0 max-w-full truncate px-1.5 font-normal", unitClassName)}
            >
              {compactUnit}
            </Badge>
          </TooltipTrigger>
          <TooltipContent side="top">{tooltip}</TooltipContent>
        </Tooltip>
      ) : null}
      {suffix ? <span className="shrink-0">{suffix}</span> : null}
    </span>
  );
}
