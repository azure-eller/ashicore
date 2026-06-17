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
  showCaret,
  className,
  style,
  ...props
}: Omit<HTMLAttributes<HTMLSpanElement>, "children" | "className" | "style"> & {
  state: FulfillmentDisplayState;
  footer?: ReactNode;
  marker?: ReactNode;
  /** Show the dropdown caret when this chip's cell opens a panel. */
  showCaret?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <StatusBlock
      tone={fulfillmentStatusBlockTone[state.tone]}
      footer={footer}
      marker={marker}
      showCaret={showCaret}
      className={className}
      style={style}
      {...props}
    >
      {state.label}
    </StatusBlock>
  );
}
