export const accountStateOptions = [
  { value: "active", label: "Active" },
  { value: "growth", label: "Growth" },
  { value: "at_risk", label: "At risk" },
  { value: "former", label: "Former" },
];

export const accountPriorityOptions = [
  { value: "strategic", label: "Strategic" },
  { value: "high", label: "High" },
  { value: "standard", label: "Standard" },
  { value: "low", label: "Low" },
];

export const accountStateDots: Record<string, string> = {
  active: "bg-[var(--color-success)]",
  growth: "bg-[var(--color-accent)]",
  at_risk: "bg-[var(--color-danger)]",
  former: "bg-[var(--color-ink-faint)]",
};

export const accountPriorityDots: Record<string, string> = {
  strategic: "bg-[var(--color-warning)]",
  high: "bg-[var(--color-accent)]",
  standard: "bg-[var(--color-ink-faint)]",
  low: "bg-[var(--color-line)]",
};

export function optionLabel(
  options: Array<{ value: string; label: string }>,
  value: string | null | undefined
) {
  return options.find((option) => option.value === value)?.label ?? value ?? "—";
}

export function shortDayLabel(day: string) {
  const [year, month, date] = day.split("-").map(Number);
  if (!year || !month || !date) return day;
  const value = new Date(year, month - 1, date);
  return value.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(year === new Date().getFullYear() ? {} : { year: "numeric" }),
  });
}
