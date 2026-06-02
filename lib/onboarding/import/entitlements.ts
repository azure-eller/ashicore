export async function getSkuImportLimitForOrg(orgId: string): Promise<number | null> {
  void orgId;
  const raw = process.env.ONBOARDING_IMPORT_SKU_LIMIT;
  if (!raw) return null;

  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : null;
}
