import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api/responses";

export type DomainFieldErrors = Record<string, string[]>;

type DomainErrorOptions<TExtra extends Record<string, unknown> | undefined> = {
  name?: string;
  errors?: DomainFieldErrors;
  extra?: TExtra;
};

export class DomainError<
  TExtra extends Record<string, unknown> | undefined = undefined,
> extends Error {
  readonly status: number;
  readonly errors?: DomainFieldErrors;
  protected readonly extra?: TExtra;

  constructor(
    message: string,
    status = 400,
    options?: DomainErrorOptions<TExtra>
  ) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = options?.name ?? "DomainError";
    this.status = status;
    this.errors = options?.errors;
    this.extra = options?.extra;
  }

  toResponse(): NextResponse<Record<string, unknown>> {
    const extra =
      this.extra != null
        ? this.extra
        : this.errors != null
          ? { errors: this.errors }
          : undefined;

    return jsonError(this.message, this.status, extra);
  }
}
