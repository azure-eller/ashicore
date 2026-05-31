import { Badge } from "@/components/ui/badge";

const ATTRIBUTE_BADGE_VARIANTS = ["secondary", "outline", "default"] as const;

export function AttributeBadges({ attrs }: { attrs: string[] }) {
  return attrs.map((attr, index) => (
    <Badge
      key={`${attr}-${index}`}
      variant={ATTRIBUTE_BADGE_VARIANTS[index % ATTRIBUTE_BADGE_VARIANTS.length]}
      className="text-[length:var(--text-xs)] font-normal"
    >
      {attr}
    </Badge>
  ));
}
