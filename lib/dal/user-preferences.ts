import "server-only";

import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { userPreferences } from "@/lib/db/schema";
import {
  normalizeReadabilityOption,
  type ReadabilityOption,
} from "@/lib/schemas/account";

export async function getPersistedReadabilityForUser(
  userId: string
): Promise<ReadabilityOption | null> {
  try {
    const [row] = await db
      .select({
        readability: userPreferences.readability,
      })
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .limit(1);

    if (!row) {
      return null;
    }

    return normalizeReadabilityOption(row.readability);
  } catch {
    return null;
  }
}

export async function getOptionalSessionReadability(): Promise<ReadabilityOption | null> {
  try {
    const requestHeaders = await headers();
    const session = await auth.api.getSession({
      headers:
        requestHeaders instanceof Headers
          ? requestHeaders
          : new Headers(requestHeaders),
    });

    if (!session) {
      return null;
    }

    return getPersistedReadabilityForUser(session.user.id);
  } catch {
    return null;
  }
}
