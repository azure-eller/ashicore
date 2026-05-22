import { getCollection } from "astro:content";
import { absoluteUrl, publicPages } from "../lib/site";
import { compareDocs, docUrl } from "../lib/docs";

export async function GET() {
  const docs = (await getCollection("docs")).sort(compareDocs);
  const pages = [
    ...publicPages,
    ...docs.map((entry) => ({ path: docUrl(entry), priority: "0.7" })),
  ];
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
