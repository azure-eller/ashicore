import "server-only";

import { hasModuleAccess } from "@/lib/authz";
import type { AgentToolMemberContext } from "@/lib/agent/core";
import type { RegisteredAction } from "@/lib/agent/chat/actions/types";
import {
  customerCreateAction,
  customerUpdateAction,
  salesOrderCreateAction,
} from "@/lib/agent/chat/actions/sales";
import { purchaseOrderCreateAction } from "@/lib/agent/chat/actions/purchasing";
import { manufacturingOrderCreateAction } from "@/lib/agent/chat/actions/manufacturing";
import {
  itemCreateAction,
  itemUpdateAction,
  stockAdjustmentCreateAction,
  stocktakeCreateAction,
  stocktakeRecordCountsAction,
} from "@/lib/agent/chat/actions/inventory";

/**
 * The allowlist. Every write the agent can stage lives here — nothing else is
 * reachable through the `stage` tool. Destructive (delete), auth/team, billing,
 * and integration routes are deliberately absent.
 */
const ALL_ACTIONS: RegisteredAction[] = [
  salesOrderCreateAction,
  customerCreateAction,
  customerUpdateAction,
  purchaseOrderCreateAction,
  manufacturingOrderCreateAction,
  itemCreateAction,
  itemUpdateAction,
  stockAdjustmentCreateAction,
  stocktakeCreateAction,
  stocktakeRecordCountsAction,
];

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
