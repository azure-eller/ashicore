import { Badge } from "@/components/ui/badge";
import { formatRoleLabel, normalizeAppRole } from "@/lib/authz";

export function TeamRoleBadge({ role }: { role: string | null | undefined }) {
  const normalized = normalizeAppRole(role);

  if (normalized === "owner") {
    return <Badge>{formatRoleLabel(normalized)}</Badge>;
  }

  if (normalized === "admin") {
    return <Badge variant="secondary">{formatRoleLabel(normalized)}</Badge>;
  }

  return <Badge variant="outline">{formatRoleLabel(normalized)}</Badge>;
}
