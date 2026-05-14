import { NextResponse } from "next/server";

export const APP_ROLES = ["owner", "admin", "member"] as const;

export const MODULE_KEYS = [
  "inventory",
  "sales",
  "manufacturing",
  "purchasing",
  "settings",
] as const;

export const MODULE_ACCESS_LEVELS = ["none", "read", "operate", "admin"] as const;
export const MATRIX_SENTINEL_ROLE = "access:matrix" as const;
export const ACCESS_PRESET_KEYS = [
  "admin",
  "ops_manager",
  "ops_operator",
  "sales_manager",
  "sales_operator",
  "view_only",
] as const;

export type AppRole = (typeof APP_ROLES)[number];
export type ModuleKey = (typeof MODULE_KEYS)[number];
export type ModuleAccessLevel = (typeof MODULE_ACCESS_LEVELS)[number];
export type ModuleAccessMap = Record<ModuleKey, ModuleAccessLevel>;
export type MatrixModuleRole = `${ModuleKey}:${Exclude<ModuleAccessLevel, "none">}`;
export type AccessPresetKey = (typeof ACCESS_PRESET_KEYS)[number];
export type DerivedAccessPresetKey = AccessPresetKey | "custom";

const MODULE_ACCESS_RANK: Record<ModuleAccessLevel, number> = {
  none: 0,
  read: 1,
  operate: 2,
  admin: 3,
};

const GOVERNANCE_ROLE_PRIORITY: readonly string[] = [
  "owner",
  "admin",
  "member",
] as const;

const EMPTY_MODULE_ACCESS: ModuleAccessMap = {
  inventory: "none",
  sales: "none",
  manufacturing: "none",
  purchasing: "none",
  settings: "none",
};

const OWNER_MODULE_ACCESS: ModuleAccessMap = {
  inventory: "admin",
  sales: "admin",
  manufacturing: "admin",
  purchasing: "admin",
  settings: "admin",
};

const ACCESS_PRESET_DEFINITIONS: Record<AccessPresetKey, ModuleAccessMap> = {
  admin: {
    inventory: "admin",
    sales: "admin",
    manufacturing: "admin",
    purchasing: "admin",
    settings: "admin",
  },
  ops_manager: {
    inventory: "admin",
    sales: "read",
    manufacturing: "admin",
    purchasing: "admin",
    settings: "none",
  },
  ops_operator: {
    inventory: "read",
    sales: "read",
    manufacturing: "operate",
    purchasing: "read",
    settings: "none",
  },
  sales_manager: {
    inventory: "read",
    sales: "admin",
    manufacturing: "read",
    purchasing: "read",
    settings: "none",
  },
  sales_operator: {
    inventory: "read",
    sales: "operate",
    manufacturing: "read",
    purchasing: "read",
    settings: "none",
  },
  view_only: {
    inventory: "read",
    sales: "read",
    manufacturing: "read",
    purchasing: "read",
    settings: "none",
  },
};

function cloneModuleAccess(source: ModuleAccessMap): ModuleAccessMap {
  return { ...source };
}

function isModuleAccessMapEqual(left: ModuleAccessMap, right: ModuleAccessMap) {
  return MODULE_KEYS.every((moduleKey) => left[moduleKey] === right[moduleKey]);
}

export function splitAssignedRoles(role: string | string[] | null | undefined) {
  if (Array.isArray(role)) {
    return role
      .flatMap((value) => value.split(","))
      .map((value) => value.trim())
      .filter(Boolean);
  }

  if (!role) {
    return [];
  }

  return role
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function buildMatrixRole(
  moduleKey: ModuleKey,
  level: Exclude<ModuleAccessLevel, "none">
): MatrixModuleRole {
  return `${moduleKey}:${level}`;
}

export function isMatrixModuleRole(role: string): role is MatrixModuleRole {
  const [module, level] = role.split(":");

  return (
    MODULE_KEYS.includes(module as ModuleKey) &&
    level !== "none" &&
    MODULE_ACCESS_LEVELS.includes(level as ModuleAccessLevel)
  );
}

export function getModulePermissionActions(level: Exclude<ModuleAccessLevel, "none">) {
  switch (level) {
    case "read":
      return ["read"] as const;
    case "operate":
      return ["read", "operate"] as const;
    case "admin":
      return ["read", "operate", "admin"] as const;
  }
}

function getStoredGovernanceRole(tokens: string[]): string {
  for (const candidate of GOVERNANCE_ROLE_PRIORITY) {
    if (tokens.includes(candidate)) {
      return candidate;
    }
  }

  return "member";
}

function hasMatrixAssignments(tokens: string[]) {
  return tokens.includes(MATRIX_SENTINEL_ROLE);
}

function getMatrixDefaults(role: AppRole): ModuleAccessMap {
  if (role === "owner") {
    return cloneModuleAccess(OWNER_MODULE_ACCESS);
  }

  return cloneModuleAccess(EMPTY_MODULE_ACCESS);
}

export function normalizeAppRole(role: string | string[] | null | undefined): AppRole {
  const storedRole = getStoredGovernanceRole(splitAssignedRoles(role));

  if (storedRole === "owner" || storedRole === "admin") {
    return storedRole;
  }

  return "member";
}

export function canManageTargetRole(
  actorRole: string | string[] | null | undefined,
  targetRole: string | string[] | null | undefined
) {
  const target = normalizeAppRole(targetRole);

  if (normalizeAppRole(actorRole) === "owner") {
    return target !== "owner";
  }

  if (canManageTeam(actorRole)) {
    return target !== "owner";
  }

  return false;
}

export function formatRoleLabel(role: string | string[] | null | undefined) {
  const normalized = normalizeAppRole(role);
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

export function formatAccessPresetLabel(presetKey: DerivedAccessPresetKey) {
  switch (presetKey) {
    case "admin":
      return "Admin";
    case "ops_manager":
      return "Ops Manager";
    case "ops_operator":
      return "Ops Operator";
    case "sales_manager":
      return "Sales Manager";
    case "sales_operator":
      return "Sales Operator";
    case "view_only":
      return "View Only";
    case "custom":
      return "Custom";
  }
}

export function formatAccessLevelLabel(level: ModuleAccessLevel) {
  switch (level) {
    case "none":
      return "None";
    case "read":
      return "Read";
    case "operate":
      return "Operate";
    case "admin":
      return "Admin";
  }
}

export function formatModuleLabel(module: ModuleKey) {
  switch (module) {
    case "inventory":
      return "Inventory";
    case "sales":
      return "Sales";
    case "manufacturing":
      return "Manufacturing";
    case "purchasing":
      return "Purchasing";
    case "settings":
      return "Settings";
  }
}

export function getInitialModuleAccess(governanceRole: AppRole): ModuleAccessMap {
  if (governanceRole === "owner") {
    return cloneModuleAccess(OWNER_MODULE_ACCESS);
  }

  if (governanceRole === "admin") {
    return cloneModuleAccess(EMPTY_MODULE_ACCESS);
  }

  return cloneModuleAccess(EMPTY_MODULE_ACCESS);
}

export function getAccessPresetKeys() {
  return [...ACCESS_PRESET_KEYS];
}

export function getAccessPresetModuleAccess(presetKey: AccessPresetKey): ModuleAccessMap {
  return cloneModuleAccess(ACCESS_PRESET_DEFINITIONS[presetKey]);
}

export function getDerivedAccessPresetKey(
  access: Partial<Record<ModuleKey, ModuleAccessLevel>>
): DerivedAccessPresetKey {
  const normalized = normalizeModuleAccess("member", access);

  for (const presetKey of ACCESS_PRESET_KEYS) {
    if (
      isModuleAccessMapEqual(
        normalized,
        ACCESS_PRESET_DEFINITIONS[presetKey]
      )
    ) {
      return presetKey;
    }
  }

  return "custom";
}

export function normalizeModuleAccess(
  governanceRole: AppRole,
  access: Partial<Record<ModuleKey, ModuleAccessLevel>>
): ModuleAccessMap {
  const normalized = getInitialModuleAccess(governanceRole);

  for (const moduleKey of MODULE_KEYS) {
    const level = access[moduleKey];

    if (!level) {
      continue;
    }

    normalized[moduleKey] = level;
  }

  if (governanceRole === "owner") {
    return cloneModuleAccess(OWNER_MODULE_ACCESS);
  }

  return normalized;
}

export function buildAssignedRoles(
  governanceRole: AppRole,
  access: Partial<Record<ModuleKey, ModuleAccessLevel>>
) {
  const normalizedAccess = normalizeModuleAccess(governanceRole, access);

  if (governanceRole === "owner") {
    return [MATRIX_SENTINEL_ROLE, "owner"];
  }

  const assignedRoles: string[] = [MATRIX_SENTINEL_ROLE, governanceRole];

  for (const moduleKey of MODULE_KEYS) {
    const level = normalizedAccess[moduleKey];

    if (level === "none") {
      continue;
    }

    assignedRoles.push(buildMatrixRole(moduleKey, level));
  }

  return assignedRoles;
}

export function buildPresetAssignedRoles(presetKey: AccessPresetKey) {
  return buildAssignedRoles("member", getAccessPresetModuleAccess(presetKey));
}

export function getModuleAccessMap(role: string | string[] | null | undefined): ModuleAccessMap {
  const tokens = splitAssignedRoles(role);
  const governanceRole = normalizeAppRole(tokens);
  const moduleAccess = hasMatrixAssignments(tokens)
    ? getMatrixDefaults(governanceRole)
    : cloneModuleAccess(EMPTY_MODULE_ACCESS);

  for (const token of tokens) {
    if (!isMatrixModuleRole(token)) {
      continue;
    }

    const [tokenModule, tokenLevel] = token.split(":") as [
      ModuleKey,
      Exclude<ModuleAccessLevel, "none">,
    ];

    if (MODULE_ACCESS_RANK[tokenLevel] > MODULE_ACCESS_RANK[moduleAccess[tokenModule]]) {
      moduleAccess[tokenModule] = tokenLevel;
    }
  }

  return moduleAccess;
}

export function resolveModuleAccessLevel(
  role: string | string[] | null | undefined,
  moduleKey: ModuleKey
): ModuleAccessLevel {
  return getModuleAccessMap(role)[moduleKey];
}

export function hasModuleAccess(
  role: string | string[] | null | undefined,
  module: ModuleKey,
  requiredLevel: Exclude<ModuleAccessLevel, "none">
) {
  if (normalizeAppRole(role) === "owner") {
    return true;
  }

  const currentLevel = resolveModuleAccessLevel(role, module);
  return MODULE_ACCESS_RANK[currentLevel] >= MODULE_ACCESS_RANK[requiredLevel];
}

export function canViewUnlockedBom(role: string | string[] | null | undefined) {
  return (
    hasModuleAccess(role, "inventory", "operate") ||
    hasModuleAccess(role, "manufacturing", "operate")
  );
}

export function canViewLockedBom(role: string | string[] | null | undefined) {
  return (
    hasModuleAccess(role, "inventory", "admin") ||
    hasModuleAccess(role, "manufacturing", "admin")
  );
}

export function canManageLockedBom(role: string | string[] | null | undefined) {
  return hasModuleAccess(role, "inventory", "admin");
}

export function canReadModule(role: string | string[] | null | undefined, module: ModuleKey) {
  return hasModuleAccess(role, module, "read");
}

export function canReadPlanning(role: string | string[] | null | undefined) {
  return (
    hasModuleAccess(role, "inventory", "read") &&
    hasModuleAccess(role, "sales", "read") &&
    hasModuleAccess(role, "manufacturing", "read") &&
    hasModuleAccess(role, "purchasing", "read")
  );
}

export function canWriteModule(role: string | string[] | null | undefined, module: ModuleKey) {
  return hasModuleAccess(role, module, "operate");
}

export function canManageTeam(role: string | string[] | null | undefined) {
  return (
    normalizeAppRole(role) === "owner" ||
    hasModuleAccess(role, "settings", "admin")
  );
}

export function canGrantTeamManagement(role: string | string[] | null | undefined) {
  return normalizeAppRole(role) === "owner";
}

export function canAssignModuleAccess(
  actorRole: string | string[] | null | undefined,
  access: Partial<Record<ModuleKey, ModuleAccessLevel>>
) {
  if (canGrantTeamManagement(actorRole)) {
    return true;
  }

  return access.settings !== "admin";
}

export function getDefaultDashboardPath(role: string | string[] | null | undefined) {
  if (canReadModule(role, "sales")) {
    return "/sales/orders";
  }

  if (canReadModule(role, "inventory")) {
    return "/inventory/materials";
  }

  if (canReadModule(role, "manufacturing")) {
    return "/manufacturing/orders";
  }

  if (canReadModule(role, "purchasing")) {
    return "/purchasing/orders";
  }

  return "/no-access";
}

export class AuthorizationError extends Error {
  constructor(
    message = "You do not have permission to perform this action.",
    public status = 403
  ) {
    super(message);
    this.name = "AuthorizationError";
  }

  toResponse() {
    return NextResponse.json({ error: this.message }, { status: this.status });
  }
}
