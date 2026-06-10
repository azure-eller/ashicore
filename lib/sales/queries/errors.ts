import "server-only";

import { DomainError } from "@/lib/errors/domain-error";
import type { NegativeStockWarningPayload } from "../types";

export class SalesError extends DomainError<{
  negativeStock: NegativeStockWarningPayload;
}> {
  negativeStock?: NegativeStockWarningPayload;

  constructor(
    message: string,
    status = 400,
    options?: {
      errors?: Record<string, string[]>;
      negativeStock?: NegativeStockWarningPayload;
    }
  ) {
    super(message, status, {
      name: "SalesError",
      errors: options?.errors,
      extra: options?.negativeStock
        ? { negativeStock: options.negativeStock }
        : undefined,
    });

    this.negativeStock = options?.negativeStock;
  }
}
