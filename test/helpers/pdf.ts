import { inflateSync } from "node:zlib";

/**
 * Extract the visible text from a `@react-pdf/renderer` document.
 *
 * Content streams are FlateDecode compressed, and react-pdf writes glyphs as
 * hex strings inside `TJ` arrays rather than literal PDF strings:
 *
 *   [<50> 0 <7572> 20 <63> 10 <68617365206f72> ...] TJ  ->  "Purchase or..."
 *
 * Runs are concatenated in stream order with a newline between streams, so
 * assertions should use substring matching rather than exact equality.
 */
export function extractPdfText(buffer: Buffer): string {
  const chunks: string[] = [];
  const marker = Buffer.from("stream");
  const endMarker = Buffer.from("endstream");

  let cursor = 0;
  while (cursor < buffer.length) {
    const start = buffer.indexOf(marker, cursor);
    if (start === -1) break;
    const end = buffer.indexOf(endMarker, start);
    if (end === -1) break;

    // Skip past "stream" plus its trailing EOL (\n or \r\n).
    let dataStart = start + marker.length;
    if (buffer[dataStart] === 0x0d) dataStart += 1;
    if (buffer[dataStart] === 0x0a) dataStart += 1;

    const raw = buffer.subarray(dataStart, end);
    try {
      chunks.push(inflateSync(raw).toString("latin1"));
    } catch {
      // Not a compressed content stream (xref tables, raw object data).
    }
    cursor = end + endMarker.length;
  }

  const shown: string[] = [];
  const tokenRe = /<([0-9A-Fa-f\s]*)>|\((?:\\.|[^\\()])*\)/g;
  for (const chunk of chunks) {
    let match: RegExpExecArray | null;
    tokenRe.lastIndex = 0;
    while ((match = tokenRe.exec(chunk))) {
      if (match[1] != null) {
        const hex = match[1].replace(/\s+/g, "");
        if (hex.length % 2 !== 0) continue;
        shown.push(Buffer.from(hex, "hex").toString("latin1"));
      } else {
        shown.push(
          match[0]
            .slice(1, -1)
            .replace(/\\([()\\])/g, "$1")
            .replace(/\\(\d{1,3})/g, (_, oct) =>
              String.fromCharCode(Number.parseInt(oct, 8)),
            ),
        );
      }
    }
    shown.push("\n");
  }
  return shown.join("");
}
