"use client";

import { useEffect } from "react";
import NextError from "next/error";
import { captureAppError } from "@/lib/observability/sentry";

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    captureAppError(error, {
      source: "global_error_boundary",
      digest: error.digest,
      runtime: "browser",
    });
  }, [error]);

  return (
    <html lang="en">
      <body>
        <NextError statusCode={0} />
      </body>
    </html>
  );
}
