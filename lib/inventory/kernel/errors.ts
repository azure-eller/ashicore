import { DomainError } from "@/lib/errors/domain-error";

export class MissingIdempotencyKeyError extends DomainError {
  constructor(operationName: string) {
    super(`Missing Idempotency-Key header for ${operationName}.`, 400, {
      name: "MissingIdempotencyKeyError",
    });
  }
}

export class IdempotencyConflictError extends DomainError<{
  idempotencyKey: string;
  operationName: string;
}> {
  constructor(idempotencyKey: string, operationName: string) {
    super("This idempotency key was already used for a different request.", 409, {
      name: "IdempotencyConflictError",
      extra: { idempotencyKey, operationName },
    });
  }
}

export class IdempotencyInFlightError extends DomainError<{
  idempotencyKey: string;
  operationName: string;
}> {
  constructor(idempotencyKey: string, operationName: string) {
    super("A concurrent request with this idempotency key is still in flight.", 409, {
      name: "IdempotencyInFlightError",
      extra: { idempotencyKey, operationName },
    });
  }
}

export class MissingCostBasisError extends DomainError<{
  itemId: string;
  reason: string;
}> {
  readonly itemId: string;
  readonly reason: string;

  constructor(itemId: string, reason: string, message: string) {
    super(message, 400, {
      name: "MissingCostBasisError",
      extra: { itemId, reason },
    });
    this.itemId = itemId;
    this.reason = reason;
  }
}

export class InsufficientStockError extends DomainError<{
  itemId: string;
  available: number;
  requested: number;
}> {
  readonly itemId: string;
  readonly available: number;
  readonly requested: number;

  constructor(params: { itemId: string; available: number; requested: number }) {
    super(
      `Insufficient stock. Available: ${params.available}, requested: ${params.requested}.`,
      409,
      {
        name: "InsufficientStockError",
        extra: params,
      }
    );
    this.itemId = params.itemId;
    this.available = params.available;
    this.requested = params.requested;
  }
}

export class InventoryDispositionError extends DomainError<{
  itemId?: string;
  lotId?: string;
  disposition?: string;
  available?: number;
  requested?: number;
}> {}

export class ProjectionDriftError extends DomainError<{
  deltas: Record<string, unknown>;
}> {
  constructor(deltas: Record<string, unknown>) {
    super("Inventory projections drift from the ledger.", 500, {
      name: "ProjectionDriftError",
      extra: { deltas },
    });
  }
}

export class InventoryInvariantViolationError extends DomainError<{
  check: string;
}> {
  constructor(check: string) {
    super("An inventory invariant was violated.", 500, {
      name: "InventoryInvariantViolationError",
      extra: { check },
    });
  }
}
