import { listEntityForAgent } from "@/lib/agent/erp/read-models/list";
import type { ErpEntityType, ErpSearchHit, ErpSearchOutput } from "@/lib/agent/erp/read-models/types";

const SEARCH_FANOUT_LIMIT = 200;

function extractMatchedOn(fields: Record<string, unknown>, query: string) {
  const normalizedQuery = query.toLowerCase();
  const matches: string[] = [];

  for (const [key, value] of Object.entries(fields)) {
    if (value == null) {
      continue;
    }

    if (typeof value === "string" && value.toLowerCase().includes(normalizedQuery)) {
      matches.push(key);
      continue;
    }

    if (typeof value === "number" && String(value).includes(query)) {
      matches.push(key);
    }
  }

  return matches;
}

function scoreHit(hit: ErpSearchHit, query: string) {
  const normalizedQuery = query.toLowerCase();
  const title = hit.title.toLowerCase();
  const subtitle = hit.subtitle?.toLowerCase() ?? "";

  if (title === normalizedQuery) {
    return 300;
  }

  if (title.startsWith(normalizedQuery)) {
    return 200;
  }

  if (title.includes(normalizedQuery)) {
    return 120;
  }

  if (subtitle.includes(normalizedQuery)) {
    return 80;
  }

  return 40 - hit.matchedOn.length;
}

export async function crossEntitySearchForAgent(args: {
  entityTypes: ErpEntityType[];
  query: string;
  limit: number;
  offset: number;
}): Promise<ErpSearchOutput> {
  const query = args.query.trim();

  const entityResults = await Promise.all(
    args.entityTypes.map(async (entityType) => {
      const listed = await listEntityForAgent({
        entityType,
        limit: SEARCH_FANOUT_LIMIT,
        offset: 0,
        search: query,
      } as never);

      return listed.items.map<ErpSearchHit>((item) => ({
        entityType,
        id: item.id,
        title: item.title,
        subtitle: item.subtitle,
        badges: item.badges,
        matchedOn: extractMatchedOn(item.fields, query),
      }));
    })
  );

  const combined = entityResults
    .flat()
    .sort((left, right) => scoreHit(right, query) - scoreHit(left, query));

  const paged = combined.slice(args.offset, args.offset + args.limit);
  const nextOffset = args.offset + paged.length;

  return {
    items: paged,
    truncated: nextOffset < combined.length,
    nextOffset: nextOffset < combined.length ? nextOffset : undefined,
  };
}

