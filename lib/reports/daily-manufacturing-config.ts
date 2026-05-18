export type DailyManufacturingProductTypeGraphConfig = {
  id: string;
  label: string;
  unitName: string;
  productTextIncludes: string | null;
  color: string;
};

export type DailyManufacturingReportScheduleConfig = {
  productTypeGraphs?: DailyManufacturingProductTypeGraphConfig[];
};

export const dailyManufacturingGraphColors = [
  "#2F5DAE",
  "#7B5BD9",
  "#15803D",
  "#B7791F",
  "#0F766E",
  "#B03A2E",
] as const;

export function createDailyManufacturingGraphId() {
  return `graph-${Math.random().toString(36).slice(2, 10)}`;
}

export function getDefaultDailyManufacturingProductTypeGraphs(): DailyManufacturingProductTypeGraphConfig[] {
  return [
    {
      id: createDailyManufacturingGraphId(),
      label: "",
      unitName: "",
      productTextIncludes: null,
      color: dailyManufacturingGraphColors[0],
    },
  ];
}

export function normalizeDailyManufacturingReportConfig(
  value: DailyManufacturingReportScheduleConfig | null | undefined
): DailyManufacturingReportScheduleConfig {
  return {
    productTypeGraphs: (value?.productTypeGraphs ?? [])
      .map((graph, index) => ({
        id: graph.id || `graph-${index + 1}`,
        label: graph.label.trim(),
        unitName: graph.unitName.trim(),
        productTextIncludes: graph.productTextIncludes?.trim() || null,
        color: normalizeGraphColor(graph.color, dailyManufacturingGraphColors[index % dailyManufacturingGraphColors.length]),
      }))
      .filter((graph) => graph.label.length > 0 && graph.unitName.length > 0),
  };
}

export function normalizeGraphColor(value: string, fallback: string = dailyManufacturingGraphColors[0]) {
  const normalized = value.trim();
  return /^#[0-9a-fA-F]{6}$/.test(normalized) ? normalized.toUpperCase() : fallback;
}
