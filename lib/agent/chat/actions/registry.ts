import "server-only";

import { hasModuleAccess } from "@/lib/authz";
import type { AgentToolMemberContext } from "@/lib/agent/core";
import type { RegisteredAction } from "@/lib/agent/chat/actions/types";
import { salesOrderCreateAction } from "@/lib/agent/chat/actions/sales";

/**
 * The allowlist. Every write the agent can stage lives here — nothing else is
 * reachable through the `stage` tool. Destructive (delete), auth/team, billing,
 * and integration routes are deliberately absent.
 */
const ALL_ACTIONS: RegisteredAction[] = [salesOrderCreateAction];

const BY_NAME = new Map(ALL_ACTIONS.map((action) => [action.name, action] as const));

export function getAgentAction(name: string): RegisteredAction | undefined {
  return BY_NAME.get(name);
}

export function memberCanUseAction(
  member: AgentToolMemberContext,
  action: RegisteredAction
): boolean {
  return hasModuleAccess(member.assignedRoles, action.module, action.capability);
}

/** Actions the member is authorized to stage — what list_actions advertises. */
export function listAgentActions(member: AgentToolMemberContext): RegisteredAction[] {
  return ALL_ACTIONS.filter((action) => memberCanUseAction(member, action));
}

export function allAgentActionNames(): string[] {
  return ALL_ACTIONS.map((action) => action.name);
}
