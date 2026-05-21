import { absoluteUrl, publicPages } from "../lib/site";

export function GET() {
  const urls = publicPages
    .map(
      (page) => `
  <url>
    <loc>${absoluteUrl(page.path)}</loc>
    <priority>${page.priority}</priority>
  </url>`
    )
    .join("");

  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}
</urlset>
`,
    {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
      },
    }
  );
}
