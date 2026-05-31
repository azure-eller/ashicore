export function formatDurationMs(value: number) {
  return value.toFixed(1);
}

export function formatDurationMsNumber(value: number) {
  return Number(formatDurationMs(value));
}
