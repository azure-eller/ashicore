import "server-only";

import { DomainError, type DomainFieldErrors } from "@/lib/errors/domain-error";

export class PurchasingError extends DomainError<{
  overReceipt: {
    lines: Array<{
      lineId: string;
      itemName: string;
      remaining: string;
      requested: string;
      overage: string;
    }>;
  };
}> {
  errors?: Record<string, string[]>;
  overReceipt?: {
    lines: Array<{
      lineId: string;
      itemName: string;
      remaining: string;
      requested: string;
      overage: string;
    }>;
  };

  constructor(
    message: string,
    status = 400,
    options?: {
      errors?: Record<string, string[]>;
      overReceipt?: {
        lines: Array<{
          lineId: string;
          itemName: string;
          remaining: string;
          requested: string;
          overage: string;
        }>;
      };
    },
  ) {
    const errors: DomainFieldErrors | undefined = options?.errors;

    super(message, status, {
      name: "PurchasingError",
      errors,
      extra: options?.overReceipt
        ? { overReceipt: options.overReceipt }
        : undefined,
    });

    this.errors = options?.errors;
    this.overReceipt = options?.overReceipt;
  }
}
