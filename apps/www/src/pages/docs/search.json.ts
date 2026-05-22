import { getCollection } from "astro:content";
import { compareDocs, docUrl, plainText } from "../../lib/docs";

export async function GET() {
  const docs = (await getCollection("docs")).sort(compareDocs);

  return new Response(
    JSON.stringify(
      docs.map((entry) => ({
        title: entry.data.title,
        description: entry.data.description,
        section: entry.data.section,
        url: docUrl(entry),
        text: plainText(entry.body),
      }))
    ),
    {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=300",
      },
    }
  );
}
