import { getCollection } from "astro:content";
import { absoluteUrl, publicPages } from "../lib/site";

export async function GET() {
  const docs = await getCollection("docs");
  const publicPaths = new Set(publicPages.map((page) => page.path));
  const docsPages = docs
    .map((entry) => ({
      path: `/${entry.id}`.replace(/\/index$/, ""),
      priority: "0.7",
    }))
    .filter((page) => !publicPaths.has(page.path));
  const pages = [...publicPages, ...docsPages];
  const urls = pages
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
