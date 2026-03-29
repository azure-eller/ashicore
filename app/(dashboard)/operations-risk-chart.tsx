"use client";

import { Area, AreaChart, CartesianGrid, XAxis } from "recharts";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";

const chartData = [
  { day: "Mon", risk: null },
  { day: "Tue", risk: null },
  { day: "Wed", risk: null },
  { day: "Thu", risk: null },
  { day: "Fri", risk: null },
  { day: "Sat", risk: null },
  { day: "Sun", risk: null },
  { day: "Mon 2", risk: null },
  { day: "Tue 2", risk: null },
  { day: "Wed 2", risk: null },
  { day: "Thu 2", risk: null },
  { day: "Fri 2", risk: null },
  { day: "Sat 2", risk: null },
  { day: "Sun 2", risk: null },
];

const chartConfig = {
  risk: {
    label: "Operational risk",
    color: "var(--color-chart-1)",
  },
} satisfies ChartConfig;

export function OperationsRiskChart() {
  return (
    <div className="relative overflow-hidden rounded-xl border border-border/60 bg-muted/20">
      <ChartContainer
        config={chartConfig}
        className="min-h-64 w-full [&_.recharts-cartesian-grid-horizontal_line]:stroke-dashed"
      >
        <AreaChart data={chartData} margin={{ left: 4, right: 4, top: 12, bottom: 0 }}>
          <defs>
            <linearGradient id="operations-risk-shell" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--color-risk)" stopOpacity={0.16} />
              <stop offset="95%" stopColor="var(--color-risk)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="day"
            tickLine={false}
            axisLine={false}
            tickMargin={10}
            interval={1}
            tickFormatter={(value) => value.replace(" 2", "")}
          />
          <Area
            dataKey="risk"
            type="monotone"
            stroke="var(--color-risk)"
            strokeWidth={2}
            fill="url(#operations-risk-shell)"
            connectNulls={false}
            activeDot={false}
            dot={false}
          />
        </AreaChart>
      </ChartContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-linear-to-b from-background/10 via-background/35 to-background/85 text-center">
        <p className="text-sm font-medium text-foreground">Operational risk trend activates next</p>
        <p className="max-w-md text-sm text-muted-foreground">
          This chart is wired into the shell now and will render live counts once exception
          queries land for sales, inventory, purchasing, and manufacturing.
        </p>
      </div>
    </div>
  );
}
