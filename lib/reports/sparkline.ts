const WIDTH = 184;
const HEIGHT = 44;
const VIEW_WIDTH = 92;
const VIEW_HEIGHT = 22;
const PADDING_X = 4;
const PADDING_Y = 5;

export function parseSparklineValues(value: string | null) {
  if (!value) return [];

  return value
    .split(",")
    .slice(0, 90)
    .map((entry) => Number(entry.trim()))
    .filter((entry) => Number.isFinite(entry));
}

export function normalizeSparklineColor(value: string | null) {
  const normalized = value?.trim().replace(/^#/, "") ?? "";
  if (/^[0-9a-fA-F]{6}$/.test(normalized)) {
    return `#${normalized.toUpperCase()}`;
  }

  return "#15803D";
}

export function getSparklineTrendColor(values: number[]) {
  if (values.length < 2) return "64748B";
  return values[values.length - 1] >= values[0] ? "15803D" : "B91C1C";
}

export function buildSparklineUrl(params: {
  baseUrl: string;
  values: Array<string | number>;
  color?: string;
}) {
  const url = new URL("/api/reports/sparkline.png", params.baseUrl);
  url.searchParams.set("values", params.values.join(","));
  if (params.color) {
    url.searchParams.set("color", params.color.replace(/^#/, ""));
  }
  return url.toString();
}

export function buildSparklineSvg(values: number[], color: string) {
  const points = normalizePoints(values.length > 0 ? values : [0]);
  const linePath = pointsToPath(points);
  const areaPath = `${linePath} L ${points[points.length - 1].x} ${HEIGHT - PADDING_Y} L ${points[0].x} ${HEIGHT - PADDING_Y} Z`;
  const lastPoint = points[points.length - 1];

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="transparent"/>
  <path d="${areaPath}" fill="${escapeAttribute(color)}" opacity="0.10"/>
  <path d="${linePath}" fill="none" stroke="${escapeAttribute(color)}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="${lastPoint.x}" cy="${lastPoint.y}" r="3" fill="${escapeAttribute(color)}"/>
</svg>`;
}

export const sparklineImageSize = {
  width: VIEW_WIDTH,
  height: VIEW_HEIGHT,
};

function normalizePoints(values: number[]) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const usableWidth = WIDTH - PADDING_X * 2;
  const usableHeight = HEIGHT - PADDING_Y * 2;
  const denominator = Math.max(values.length - 1, 1);

  return values.map((value, index) => ({
    x: PADDING_X + (index / denominator) * usableWidth,
    y: PADDING_Y + (1 - (value - min) / range) * usableHeight,
  }));
}

function pointsToPath(points: Array<{ x: number; y: number }>) {
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${round(point.x)} ${round(point.y)}`)
    .join(" ");
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function escapeAttribute(value: string) {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "\"":
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return char;
    }
  });
}
