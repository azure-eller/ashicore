import type { ReactNode } from "react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import cardStyles from "./card-page.module.css";

export function CellShell({
  label,
  required,
  invalid,
  children,
}: {
  label: ReactNode;
  required?: boolean;
  invalid?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={cardStyles.formField}>
      <label className={`${cardStyles.formLabel} ${invalid ? cardStyles.formLabelInvalid : ""}`}>
        {label}
        {required ? <span className={cardStyles.requiredMark}> *</span> : null}
      </label>
      {children}
    </div>
  );
}

export function CardFormRow({
  children,
  columns,
  className,
}: {
  children: ReactNode;
  columns?: "default" | "three" | "four" | "five" | "purchase-order";
  className?: string;
}) {
  return (
    <div
      className={cn(
        cardStyles.formRow,
        columns === "three" && cardStyles.formRowThree,
        columns === "four" && cardStyles.formRowFour,
        columns === "five" && cardStyles.formRowFive,
        columns === "purchase-order" && cardStyles.formRowPo,
        className,
      )}
    >
      {children}
    </div>
  );
}

export function DisabledFieldTooltip({
  reason,
  children,
}: {
  reason?: string | null;
  children: React.ReactElement;
}) {
  if (!reason) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="block w-full">{children}</span>
      </TooltipTrigger>
      <TooltipContent side="top">{reason}</TooltipContent>
    </Tooltip>
  );
}

export function underlineControlClass(invalid?: boolean, className?: string) {
  return cn(cardStyles.underlineControl, invalid && cardStyles.invalidControl, className);
}

export function ReadOnlyFieldValue({
  children,
  mono,
  title,
  className,
}: {
  children: ReactNode;
  mono?: boolean;
  title?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(cardStyles.readOnlyFieldValue, mono && cardStyles.mono, className)}
      title={title}
    >
      {children}
    </div>
  );
}
