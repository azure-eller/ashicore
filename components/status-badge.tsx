import { StatusLabel, type StatusTone } from "@/components/ui/status-label";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export type StatusBadgeConfig<TStatus extends string> = Record<
  TStatus,
  {
    label: string;
    tone: StatusTone;
    tooltip?: string;
  }
>;

export function StatusBadge<TStatus extends string>({
  status,
  config,
  tooltip = true,
}: {
  status: TStatus;
  config: StatusBadgeConfig<TStatus>;
  tooltip?: boolean;
}) {
  const meta = config[status] ?? {
    label: status,
    tone: "neutral" as const,
  };
  const label = <StatusLabel tone={meta.tone}>{meta.label}</StatusLabel>;

  if (!tooltip || !meta.tooltip) {
    return label;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{label}</TooltipTrigger>
      <TooltipContent side="top">{meta.tooltip}</TooltipContent>
    </Tooltip>
  );
}
