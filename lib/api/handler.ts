import { NextResponse } from "next/server";
import { z } from "zod";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { AuthorizationError } from "@/lib/authz";

export type RouteContext = { params: Promise<{ id: string }> };

export function apiHandler(
  fn: (request: Request, ...args: unknown[]) => Promise<NextResponse>
) {
  return async (request: Request, ...args: unknown[]) => {
    try {
      return await fn(request, ...args);
    } catch (error) {
      // Let Next.js redirect() errors propagate — swallowing them returns a 500
      if (isRedirectError(error)) throw error;
      if (error instanceof AuthorizationError) {
        return error.toResponse();
      }
      if (error instanceof z.ZodError) {
        return NextResponse.json(
          { errors: error.flatten().fieldErrors },
          { status: 400 }
        );
      }
      if (error instanceof SyntaxError) {
        return NextResponse.json(
          { error: "Invalid JSON" },
          { status: 400 }
        );
      }
      console.error("API error:", error);
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 }
      );
    }
  };
}
