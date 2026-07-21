import { readFile } from "node:fs/promises";
import path from "node:path";

// Dev-only: serves the invariants observatory (test/e2e/invariants-observatory.html)
// and the artifacts the harness writes next to it. Lives on the dev server so the
// dashboard is up whenever the harness can run at all — no separate server to start.
const FILES: Record<string, { name: string; type: string }> = {
  "": { name: "invariants-observatory.html", type: "text/html; charset=utf-8" },
  "invariants-spec.json": {
    name: "invariants-spec.json",
    type: "application/json",
  },
  "invariants-journal.jsonl": {
    name: "invariants-journal.jsonl",
    type: "text/plain; charset=utf-8",
  },
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ file?: string[] }> }
) {
  if (process.env.NODE_ENV === "production") {
    return new Response("Not found", { status: 404 });
  }
  const { file } = await params;
  const entry = FILES[(file ?? []).join("/")];
  if (!entry) {
    return new Response("Not found", { status: 404 });
  }
  try {
    const body = await readFile(
      path.join(process.cwd(), "test", "e2e", entry.name)
    );
    return new Response(body, { headers: { "Content-Type": entry.type } });
  } catch {
    // Journal/spec don't exist until the first run — 404 drives the
    // dashboard's empty states (a 200 empty body breaks its JSON parse).
    return new Response("Not found", { status: 404 });
  }
}
