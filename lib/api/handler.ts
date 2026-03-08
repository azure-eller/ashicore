import { NextResponse } from "next/server";
import { z } from "zod";

export function apiHandler(fn: (request: Request) => Promise<NextResponse>) {
  return async (request: Request) => {
    try {
      return await fn(request);
    } catch (error) {
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
