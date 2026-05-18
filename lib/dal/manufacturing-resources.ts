import "server-only";

import { and, asc, eq, isNull, sql } from "drizzle-orm";
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
    const [usage] = await tx
      .select({
        bomOperationCount: sql<number>`COUNT(DISTINCT ${bomRevisionOperationCosts.id})::int`,
        manufacturingOrderOperationCount: sql<number>`COUNT(DISTINCT ${manufacturingOrderOperationCosts.id})::int`,
      })
      .from(manufacturingResources)
      .leftJoin(
        bomRevisionOperationCosts,
        eq(bomRevisionOperationCosts.resourceId, manufacturingResources.id)
      )
      .leftJoin(
        manufacturingOrderOperationCosts,
        eq(manufacturingOrderOperationCosts.resourceId, manufacturingResources.id)
      )
      .where(and(eq(manufacturingResources.id, id), isNull(manufacturingResources.deletedAt)));

    if (
      usage &&
      (usage.bomOperationCount > 0 || usage.manufacturingOrderOperationCount > 0)
    ) {
      throw new DomainError(
        `This resource is used by ${usage.bomOperationCount} BOM operation cost line${
          usage.bomOperationCount === 1 ? "" : "s"
        } and ${usage.manufacturingOrderOperationCount} manufacturing order snapshot${
          usage.manufacturingOrderOperationCount === 1 ? "" : "s"
        }. Remove those references before deleting it.`,
        409
      );
    }

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
      const [usage] = await tx
        .select({
          bomOperationCount: sql<number>`COUNT(DISTINCT ${bomRevisionOperationCosts.id})::int`,
          manufacturingOrderOperationCount: sql<number>`COUNT(DISTINCT ${manufacturingOrderOperationCosts.id})::int`,
        })
        .from(manufacturingResources)
        .leftJoin(
          bomRevisionOperationCosts,
          eq(bomRevisionOperationCosts.resourceId, manufacturingResources.id)
        )
        .leftJoin(
          manufacturingOrderOperationCosts,
          eq(manufacturingOrderOperationCosts.resourceId, manufacturingResources.id)
        )
        .where(and(eq(manufacturingResources.id, id), isNull(manufacturingResources.deletedAt)));

      if (!usage) {
        throw new DomainError("Resource not found", 404);
      }

      if (
        usage.bomOperationCount > 0 ||
        usage.manufacturingOrderOperationCount > 0
      ) {
        throw new DomainError(
          `This resource is used by ${usage.bomOperationCount} BOM operation cost line${
            usage.bomOperationCount === 1 ? "" : "s"
          } and ${usage.manufacturingOrderOperationCount} manufacturing order snapshot${
            usage.manufacturingOrderOperationCount === 1 ? "" : "s"
          }. Remove those references before deleting it.`,
          409
        );
      }

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
