import { PUBLIC_SITE_URL } from "../lib/site";

export function GET() {
  return new Response(
    [
      "User-agent: *",
      "Allow: /",
      `Sitemap: ${PUBLIC_SITE_URL}/sitemap.xml`,
      "",
    ].join("\n"),
    {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
      },
    }
  );
}
