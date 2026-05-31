import { Badge, type badgeVariants } from "@/components/ui/badge";
import type { VariantProps } from "class-variance-authority";

type BadgeVariant = VariantProps<typeof badgeVariants>["variant"];

type ConfiguredBadgeMeta = {
  label: string;
  variant?: BadgeVariant;
};

export type ConfiguredBadgeConfig<TValue extends string> = Record<
  TValue,
  ConfiguredBadgeMeta
>;

export function ConfiguredBadge<TValue extends string>({
  value,
  config,
  fallback,
}: {
  value: string;
  config: Partial<Record<TValue, ConfiguredBadgeMeta>>;
  fallback?: ConfiguredBadgeMeta | ((value: string) => ConfiguredBadgeMeta);
}) {
  const meta =
    config[value as TValue] ??
    (typeof fallback === "function" ? fallback(value) : fallback);

  if (!meta) return null;

  return <Badge variant={meta.variant}>{meta.label}</Badge>;
}
