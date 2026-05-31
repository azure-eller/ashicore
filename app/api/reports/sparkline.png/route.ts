import sharp from "sharp";
import {
  buildSparklineSvg,
  normalizeSparklineColor,
  parseSparklineValues,
} from "@/lib/reports/sparkline";
import { requestSearchParams } from "@/lib/routing/search-params";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const searchParams = requestSearchParams(request);
  const values = parseSparklineValues(searchParams.get("values"));
  const color = normalizeSparklineColor(searchParams.get("color"));
  const svg = buildSparklineSvg(values, color);
  const png = await sharp(Buffer.from(svg)).png().toBuffer();

  return new Response(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
