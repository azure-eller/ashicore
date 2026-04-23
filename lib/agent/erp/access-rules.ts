import { canReadModule } from "@/lib/authz";

export const ERP_AGENT_MODULES = [
  "inventory",
  "sales",
  "manufacturing",
  "purchasing",
] as const;

export function hasErpAgentAccess(assignedRoles: string[]) {
  return ERP_AGENT_MODULES.some((module) => canReadModule(assignedRoles, module));
}
