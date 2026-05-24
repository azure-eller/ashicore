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
