import type { ReactNode } from "react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { CardReadOnlyValue } from "./card-field";
import cardStyles from "./card-page.module.css";

export function CardFormRow({
  children,
  columns,
  className,
}: {
  children: ReactNode;
  columns?: "default" | "two" | "halves" | "three" | "four" | "five" | "purchase-order";
  className?: string;
}) {
  return (
    <div
      className={cn(
        cardStyles.formRow,
        (columns === "default" || columns === "two") && cardStyles.formRowTwo,
        columns === "halves" && cardStyles.formRowHalves,
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
    <CardReadOnlyValue mono={mono} title={title} className={className}>
      {children}
    </CardReadOnlyValue>
  );
}
