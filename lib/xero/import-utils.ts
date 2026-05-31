import "server-only";

export function isDemoCompanyTenant(tenantName: string) {
  return tenantName.toLowerCase().startsWith("demo company");
}
