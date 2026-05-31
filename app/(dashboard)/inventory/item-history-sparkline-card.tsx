"use client";

import { useQuery } from "@tanstack/react-query";
import { Line, LineChart } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { apiJson } from "@/lib/client/api";
import { formatDate, formatQuantityWithUnitText } from "@/lib/format";
import type { ItemType } from "./types";

type ItemHistoryMode = "usage" | "production";

type ItemHistoryBucket = {
  periodStart: string;
  periodEnd: string;
  quantity: string;
};

type ItemHistory = {
  itemId: string;
  itemName: string;
  itemType: ItemType;
  mode: ItemHistoryMode;
  unitName: string | null;
  days: number;
  bucket: "week";
  buckets: ItemHistoryBucket[];
};

type ItemHistorySparklineCardProps = {
  itemId: string;
  itemType: ItemType;
};

const historyChartConfig = {
  quantity: {
    label: "Quantity",
    color: "var(--chart-1)",
  },
} satisfies ChartConfig;

function historyModeForItem(itemType: ItemType): ItemHistoryMode {
  return itemType === "product" ? "production" : "usage";
}

function historyTitle(mode: ItemHistoryMode) {
  return mode === "production" ? "Production History" : "Usage History";
}

function emptyHistoryText(mode: ItemHistoryMode) {
  return mode === "production"
    ? "No production in the last 180 days."
    : "No ledger usage in the last 180 days.";
}

async function fetchItemHistory(itemId: string, mode: ItemHistoryMode) {
  return apiJson<ItemHistory>(
    `/api/items/${itemId}/usage-history?days=180&mode=${mode}`,
    { fallbackError: "Failed to load item history." },
  );
}

export function ItemHistorySparklineCard({
  itemId,
  itemType,
}: ItemHistorySparklineCardProps) {
  const mode = historyModeForItem(itemType);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["items", itemId, "history", mode, 180],
    queryFn: () => fetchItemHistory(itemId, mode),
  });

  const chartData =
    data?.buckets.map((bucket) => ({
      periodStart: bucket.periodStart,
      periodEnd: bucket.periodEnd,
      label:
        bucket.periodStart === bucket.periodEnd
          ? formatDate(bucket.periodStart)
          : `${formatDate(bucket.periodStart)} - ${formatDate(bucket.periodEnd)}`,
      quantity: bucket.quantity,
      value: Number.parseFloat(bucket.quantity),
    })) ?? [];
  const hasHistory = chartData.some((point) => point.value > 0);

  return (
    <Card className="gap-0 py-0">
      <CardHeader className="border-b px-4 py-3">
        <CardTitle className="text-sm font-semibold">{historyTitle(mode)}</CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        {isLoading ? (
          <div className="flex min-h-48 items-center justify-center">
            <Spinner className="text-foreground" />
          </div>
        ) : isError || !data ? (
          <div className="flex min-h-48 items-center justify-center text-sm text-muted-foreground">
            History unavailable.
          </div>
        ) : hasHistory ? (
          <ChartContainer
            config={historyChartConfig}
            className="h-48 w-full aspect-auto"
            initialDimension={{ width: 640, height: 192 }}
          >
            <LineChart
              data={chartData}
              margin={{ top: 10, right: 8, bottom: 10, left: 8 }}
            >
              <ChartTooltip
                cursor={false}
                content={
                  <ChartTooltipContent
                    hideLabel
                    formatter={(_value, _name, _item, _index, payload) => {
                      const row = payload as {
                        label?: string;
                        quantity?: string;
                      };
                      return (
                        <>
                          <span className="text-muted-foreground">{row.label}</span>
                          <span className="font-mono font-medium text-foreground tabular-nums">
                            {formatQuantityWithUnitText(row.quantity, data.unitName)}
                          </span>
                        </>
                      );
                    }}
                  />
                }
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke="var(--color-quantity)"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ChartContainer>
        ) : (
          <div className="flex min-h-48 items-center justify-center text-sm text-muted-foreground">
            {emptyHistoryText(mode)}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
