import {
  ConfiguredBadge,
  type ConfiguredBadgeConfig,
} from "@/components/configured-badge";
import { formatRoleLabel, normalizeAppRole, type AppRole } from "@/lib/authz";

const teamRoleBadgeConfig = {
  owner: { label: formatRoleLabel("owner") },
  admin: { label: formatRoleLabel("admin"), variant: "secondary" },
  member: { label: formatRoleLabel("member"), variant: "outline" },
} satisfies ConfiguredBadgeConfig<AppRole>;

export function TeamRoleBadge({ role }: { role: string | null | undefined }) {
  const normalized = normalizeAppRole(role);
  return <ConfiguredBadge value={normalized} config={teamRoleBadgeConfig} />;
}
