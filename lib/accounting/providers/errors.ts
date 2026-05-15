import "server-only";

import { NextResponse } from "next/server";

export function accountingProviderErrorToResponse(error: unknown) {
  if (
    error &&
    typeof error === "object" &&
    "toResponse" in error &&
    typeof error.toResponse === "function"
  ) {
    return error.toResponse() as NextResponse;
  }

  return null;
}
