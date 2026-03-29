import { NextResponse } from "next/server";

export const APP_ROLES = [
  "owner",
  "admin",
  "operator",
  "viewer",
  "member",
] as const;

export const ASSIGNABLE_APP_ROLES = ["admin", "operator", "viewer"] as const;

export const MODULE_KEYS = [
  "inventory",
  "sales",
  "manufacturing",
  "purchasing",
  "settings",
] as const;

export type AppRole = (typeof APP_ROLES)[number];
export type AssignableAppRole = (typeof ASSIGNABLE_APP_ROLES)[number];
export type ModuleKey = (typeof MODULE_KEYS)[number];

const READ_ACCESS: Record<Exclude<AppRole, "member">, ModuleKey[]> = {
  owner: [...MODULE_KEYS],
  admin: [...MODULE_KEYS],
  operator: ["inventory", "manufacturing", "settings"],
  viewer: ["inventory", "sales", "manufacturing", "purchasing", "settings"],
};

const WRITE_ACCESS: Record<Exclude<AppRole, "member">, ModuleKey[]> = {
  owner: [...MODULE_KEYS],
  admin: [...MODULE_KEYS],
  operator: ["inventory", "manufacturing"],
  viewer: [],
};

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

export function normalizeAppRole(role: string | null | undefined): AppRole {
  if (role === "owner" || role === "admin" || role === "operator" || role === "viewer") {
    return role;
  }

  return "member";
}

export function normalizeAssignableRole(
  role: string | null | undefined
): AssignableAppRole | null {
  if (role === "admin" || role === "operator" || role === "viewer") {
    return role;
  }

  return null;
}

export function formatRoleLabel(role: string | null | undefined) {
  const normalized = normalizeAppRole(role);

  if (normalized === "member") {
    return "Viewer";
  }

  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

export function canReadModule(role: string | null | undefined, module: ModuleKey) {
  const normalizedRole = normalizeAppRole(role);

  if (normalizedRole === "member") {
    return READ_ACCESS.viewer.includes(module);
  }

  return READ_ACCESS[normalizedRole].includes(module);
}

export function canWriteModule(role: string | null | undefined, module: ModuleKey) {
  const normalizedRole = normalizeAppRole(role);

  if (normalizedRole === "member") {
    return false;
  }

  return WRITE_ACCESS[normalizedRole].includes(module);
}

export function canManageTeam(role: string | null | undefined) {
  const normalizedRole = normalizeAppRole(role);
  return normalizedRole === "owner" || normalizedRole === "admin";
}

export function canAssignRole(
  actorRole: string | null | undefined,
  targetRole: string | null | undefined
) {
  const actor = normalizeAppRole(actorRole);
  const target = normalizeAssignableRole(targetRole);

  if (!target) {
    return false;
  }

  if (actor === "owner") {
    return true;
  }

  if (actor === "admin") {
    return target === "operator" || target === "viewer";
  }

  return false;
}

export function canManageTargetRole(
  actorRole: string | null | undefined,
  targetRole: string | null | undefined
) {
  const actor = normalizeAppRole(actorRole);
  const target = normalizeAppRole(targetRole);

  if (actor === "owner") {
    return target !== "owner";
  }

  if (actor === "admin") {
    return target === "operator" || target === "viewer" || target === "member";
  }

  return false;
}

export function getAssignableRoles(actorRole: string | null | undefined) {
  const actor = normalizeAppRole(actorRole);

  if (actor === "owner") {
    return [...ASSIGNABLE_APP_ROLES];
  }

  if (actor === "admin") {
    return ASSIGNABLE_APP_ROLES.filter((role) => role !== "admin");
  }

  return [] as AssignableAppRole[];
}

export function getDefaultDashboardPath(role: string | null | undefined) {
  if (MODULE_KEYS.some((module) => canReadModule(role, module))) {
    return "/";
  }

  return "/sign-in";
}
