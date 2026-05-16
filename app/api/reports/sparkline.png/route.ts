import sharp from "sharp";
import {
  buildSparklineSvg,
  normalizeSparklineColor,
  parseSparklineValues,
} from "@/lib/reports/sparkline";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const values = parseSparklineValues(url.searchParams.get("values"));
  const color = normalizeSparklineColor(url.searchParams.get("color"));
  const svg = buildSparklineSvg(values, color);
  const png = await sharp(Buffer.from(svg)).png().toBuffer();

  return new Response(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
