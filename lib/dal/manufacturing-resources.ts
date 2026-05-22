import "server-only";

import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import {
  bomRevisionOperationCosts,
  manufacturingOrderOperationCosts,
  manufacturingResources,
} from "@/lib/db/schema";
import { trimScale } from "@/lib/db/numeric";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import { DomainError } from "@/lib/errors/domain-error";
import type {
  InsertManufacturingResource,
  UpdateManufacturingResource,
} from "@/lib/schemas/manufacturing-resources";

type AuthedTx = Parameters<Parameters<typeof withAuthedOrgContext>[0]>[0];

export async function getManufacturingResources() {
  return withAuthedOrgContext(async (tx) =>
    tx
      .select({
        id: manufacturingResources.id,
        name: manufacturingResources.name,
        description: manufacturingResources.description,
        resourceType: manufacturingResources.resourceType,
        loadedCostPerHour: trimScale(manufacturingResources.loadedCostPerHour).as(
          "loadedCostPerHour"
        ),
        createdAt: manufacturingResources.createdAt,
        updatedAt: manufacturingResources.updatedAt,
      })
      .from(manufacturingResources)
      .where(isNull(manufacturingResources.deletedAt))
      .orderBy(asc(manufacturingResources.name))
  );
}

export async function createManufacturingResource(data: InsertManufacturingResource) {
  return withAuthedOrgContext(async (tx, orgId) => {
    const [resource] = await tx
      .insert(manufacturingResources)
      .values({
        ...data,
        organizationId: orgId,
      })
      .returning({ id: manufacturingResources.id });

    return resource;
  });
}

export async function updateManufacturingResource(
  id: string,
  data: UpdateManufacturingResource
) {
  return withAuthedOrgContext(async (tx) => {
    const [resource] = await tx
      .update(manufacturingResources)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(and(eq(manufacturingResources.id, id), isNull(manufacturingResources.deletedAt)))
      .returning({ id: manufacturingResources.id });

    return resource ?? null;
  });
}

export async function deleteManufacturingResource(id: string) {
  return withAuthedOrgContext(async (tx) => {
    await detachManufacturingResourceReferencesInTx(tx, [id]);

    const [resource] = await tx
      .update(manufacturingResources)
      .set({
        deletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(manufacturingResources.id, id), isNull(manufacturingResources.deletedAt)))
      .returning({ id: manufacturingResources.id });

    return resource ?? null;
  });
}

export async function deleteManufacturingResources(ids: string[]) {
  return withAuthedOrgContext(async (tx) => {
    const deleted: string[] = [];

    for (const id of ids) {
      const [existing] = await tx
        .select({ id: manufacturingResources.id })
        .from(manufacturingResources)
        .where(and(eq(manufacturingResources.id, id), isNull(manufacturingResources.deletedAt)));

      if (!existing) {
        throw new DomainError("Resource not found", 404);
      }
      await detachManufacturingResourceReferencesInTx(tx, [id]);

      const [resource] = await tx
        .update(manufacturingResources)
        .set({
          deletedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(manufacturingResources.id, id), isNull(manufacturingResources.deletedAt)))
        .returning({ id: manufacturingResources.id });

      if (!resource) {
        throw new DomainError("Resource not found", 404);
      }

      deleted.push(resource.id);
    }

    return { deleted };
  });
}

async function detachManufacturingResourceReferencesInTx(tx: AuthedTx, ids: string[]) {
  if (ids.length === 0) return;

  await tx
    .delete(bomRevisionOperationCosts)
    .where(inArray(bomRevisionOperationCosts.resourceId, ids));

  await tx
    .update(manufacturingOrderOperationCosts)
    .set({ resourceId: null })
    .where(inArray(manufacturingOrderOperationCosts.resourceId, ids));
}
