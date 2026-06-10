import "server-only";

import { DomainError, type DomainFieldErrors } from "@/lib/errors/domain-error";
import type { ManufacturingReleaseWarningPayload } from "../types";

export class ManufacturingError extends DomainError<{
  shortage: ManufacturingReleaseWarningPayload;
}> {
  errors?: Record<string, string[]>;
  shortage?: ManufacturingReleaseWarningPayload;

  constructor(
    message: string,
    status = 400,
    options?: {
      errors?: Record<string, string[]>;
      shortage?: ManufacturingReleaseWarningPayload;
    }
  ) {
    const errors: DomainFieldErrors | undefined = options?.errors;

    super(message, status, {
      name: "ManufacturingError",
      errors,
      extra: options?.shortage ? { shortage: options.shortage } : undefined,
    });

    this.errors = options?.errors;
    this.shortage = options?.shortage;
  }
}
