import { eq, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { organization } from "@/lib/db/schema";
import { normalizeNumeric } from "@/lib/format";
import { requireLoaderPositiveQuantity } from "./quantity-validation";

export async function resolveOrganization(orgRef: string) {
  const matches = await db
    .select({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
    })
    .from(organization)
    .where(
      or(
        eq(organization.id, orgRef),
        eq(organization.slug, orgRef),
        eq(organization.name, orgRef)
      )
    );

  if (matches.length === 0) {
    throw new Error(`No organization matched "${orgRef}".`);
  }

  if (matches.length > 1) {
    throw new Error(
      `Multiple organizations matched "${orgRef}". Use a unique org id or slug.`
    );
  }

  return matches[0];
}

export function getUnitSignature(name: string, size: string, uom: string) {
  const normalizedSize = requireLoaderPositiveQuantity(
    size,
    `Unit "${name}" size`,
  );
  return `${name.toLowerCase()}|${normalizeNumeric(Number(normalizedSize))}|${uom.toLowerCase()}`;
}
