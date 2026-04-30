"use client";

import { Cell, Pie, PieChart } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { ItemCommitmentSlice } from "./commitment-summary";
import { formatQuantity } from "@/lib/format";

const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

type InventoryCommitmentDonutProps = {
  slices: ItemCommitmentSlice[];
  onHandQty: string;
  unitName: string | null;
};

export function InventoryCommitmentDonut({
  slices,
  onHandQty,
  unitName,
}: InventoryCommitmentDonutProps) {
  const chartData = slices
    .map((slice, index) => ({
      id: `${slice.type}-${index}`,
      label: slice.label,
      quantity: slice.quantity,
      value: Number(slice.quantity),
      fill: CHART_COLORS[index % CHART_COLORS.length],
    }))
    .filter((slice) => Number.isFinite(slice.value) && slice.value > 0);
  const chartConfig = chartData.reduce<ChartConfig>((config, slice) => {
    config[slice.id] = {
      label: slice.label,
      color: slice.fill,
    };
    return config;
  }, {});

  if (chartData.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <ChartContainer
          config={chartConfig}
          className="mx-auto aspect-square h-56"
          initialDimension={{ width: 224, height: 224 }}
        >
          <PieChart>
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  hideLabel
                  formatter={(_value, _name, _item, _index, payload) => {
                    const row = payload as { label?: string; quantity?: string };
                    return (
                      <>
                        <span className="text-muted-foreground">{row.label}</span>
                        <span className="font-mono font-medium text-foreground tabular-nums">
                          {formatQuantity(row.quantity)} {unitName}
                        </span>
                      </>
                    );
                  }}
                />
              }
            />
            <Pie
              data={chartData}
              dataKey="value"
              nameKey="id"
              innerRadius={58}
              outerRadius={88}
              paddingAngle={2}
              strokeWidth={3}
            >
              {chartData.map((entry) => (
                <Cell key={entry.id} fill={entry.fill} />
              ))}
            </Pie>
          </PieChart>
        </ChartContainer>
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="flex flex-col items-center gap-0.5 text-center">
            <span className="text-lg font-semibold leading-none">
              {formatQuantity(onHandQty)}
            </span>
            <span className="text-xs text-muted-foreground">{unitName ?? "units"}</span>
          </div>
        </div>
      </div>
      <div className="grid gap-2">
        {chartData.map((slice) => (
          <div key={slice.id} className="flex items-center justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-center gap-2">
              <span
                className="size-2.5 shrink-0 rounded-sm"
                style={{ backgroundColor: slice.fill }}
                aria-hidden
              />
              <span className="truncate">{slice.label}</span>
            </span>
            <span className="shrink-0 font-mono tabular-nums text-muted-foreground">
              {formatQuantity(slice.quantity)} {unitName}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
