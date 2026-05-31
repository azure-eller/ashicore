import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import type { FulfillmentDisplayState } from "@/lib/sales/fulfillment-status";
import { StatusBlock, type StatusBlockTone } from "@/components/ui/status-block";

export const fulfillmentStatusBlockTone: Record<
  FulfillmentDisplayState["tone"],
  StatusBlockTone
> = {
  destructive: "danger",
  muted: "muted",
  secondary: "warning",
  success: "success",
  warning: "warning",
};

export function FulfillmentStatusBlock({
  state,
  footer,
  marker,
  className,
  style,
  ...props
}: Omit<HTMLAttributes<HTMLSpanElement>, "children" | "className" | "style"> & {
  state: FulfillmentDisplayState;
  footer?: ReactNode;
  marker?: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <StatusBlock
      tone={fulfillmentStatusBlockTone[state.tone]}
      footer={footer}
      marker={marker}
      className={className}
      style={style}
      {...props}
    >
      {state.label}
    </StatusBlock>
  );
}
