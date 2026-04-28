import { Badge } from "@/components/ui/badge";

const BADGE_VARIANTS = ["secondary", "outline", "default"] as const;

export function OrderLineAttributeBadges({ attrs }: { attrs: string[] }) {
  return attrs.map((attr, index) => (
    <Badge
      key={`${attr}-${index}`}
      variant={BADGE_VARIANTS[index % BADGE_VARIANTS.length]}
      className="text-xs font-normal"
    >
      {attr}
    </Badge>
  ));
}
