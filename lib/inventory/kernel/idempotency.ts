import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { canonicalizeJson } from "@/lib/canonical-json";
import { inventoryIdempotencyClaims } from "@/lib/db/schema";
import type { Tx } from "@/lib/db/with-org-context";
import {
  IdempotencyConflictError,
  IdempotencyInFlightError,
  MissingIdempotencyKeyError,
} from "./errors";

export function canonicalizeIdempotencyParams(params: Record<string, unknown>) {
  return canonicalizeJson(params);
}

export function deriveInventoryIdempotencyKey(
  idempotencyKey: string | null | undefined,
  step: string
) {
  if (!idempotencyKey) {
    return null;
  }

  return `${idempotencyKey}:${step}`;
}

export function hashIdempotencyParams(params: Record<string, unknown>) {
  return createHash("sha256")
    .update(canonicalizeIdempotencyParams(params))
    .digest("hex");
}

export function getRequiredIdempotencyKey(
  request: Request,
  operationName: string
) {
  const key = request.headers.get("Idempotency-Key");

  if (!key) {
    throw new MissingIdempotencyKeyError(operationName);
  }

  return key;
}

export async function claimInventoryIdempotencyInTx(
  tx: Tx,
  params: {
    organizationId: string;
    idempotencyKey: string;
    operationName: string;
    payload: Record<string, unknown>;
  }
) {
  const paramsHash = hashIdempotencyParams(params.payload);
  const readExistingClaim = () =>
    tx.query.inventoryIdempotencyClaims.findFirst({
      where: and(
        eq(inventoryIdempotencyClaims.organizationId, params.organizationId),
        eq(inventoryIdempotencyClaims.idempotencyKey, params.idempotencyKey)
      ),
    });

  const existing = await readExistingClaim();

  if (existing) {
    if (
      existing.operationName !== params.operationName ||
      existing.paramsHash !== paramsHash
    ) {
      throw new IdempotencyConflictError(
        params.idempotencyKey,
        params.operationName
      );
    }

    if ((existing.resultEnvelope as { status?: string }).status === "pending") {
      throw new IdempotencyInFlightError(
        params.idempotencyKey,
        params.operationName
      );
    }

    return {
      claimed: false,
      claim: existing,
    };
  }

  const [claim] = await tx
    .insert(inventoryIdempotencyClaims)
    .values({
      organizationId: params.organizationId,
      idempotencyKey: params.idempotencyKey,
      operationName: params.operationName,
      paramsHash,
      resultEnvelope: { status: "pending" },
    })
    .onConflictDoNothing()
    .returning();

  if (!claim) {
    const raced = await readExistingClaim();

    if (!raced) {
      throw new IdempotencyConflictError(
        params.idempotencyKey,
        params.operationName
      );
    }

    if (
      raced.operationName !== params.operationName ||
      raced.paramsHash !== paramsHash
    ) {
      throw new IdempotencyConflictError(
        params.idempotencyKey,
        params.operationName
      );
    }

    if ((raced.resultEnvelope as { status?: string }).status === "pending") {
      throw new IdempotencyInFlightError(
        params.idempotencyKey,
        params.operationName
      );
    }

    return {
      claimed: false,
      claim: raced,
    };
  }

  return {
    claimed: true,
    claim,
  };
}

export async function completeInventoryIdempotencyClaimInTx(
  tx: Tx,
  params: {
    organizationId: string;
    idempotencyKey: string;
    firstEventId?: string | null;
    resultEnvelope: unknown;
  }
) {
  const [claim] = await tx
    .update(inventoryIdempotencyClaims)
    .set({
      firstEventId: params.firstEventId ?? null,
      resultEnvelope: params.resultEnvelope,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(inventoryIdempotencyClaims.organizationId, params.organizationId),
        eq(inventoryIdempotencyClaims.idempotencyKey, params.idempotencyKey)
      )
    )
    .returning();

  return claim;
}
