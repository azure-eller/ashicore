/**
 * Dot-path model for card documents. Paths address scalar fields ("name"),
 * row leaves inside declared collections ("lines.<rowId>.quantityOrdered"),
 * whole rows ("lines.<rowId>" — present in one doc but not the other), and
 * row ordering ("lines.$order"). Collection segments are row IDS, never array
 * indexes, so paths stay stable across server reorders and saves.
 */

export type CollectionSpec = Record<string, { idKey: string }>;

export const ORDER_SEGMENT = "$order";

type Row = Record<string, unknown>;

export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a instanceof Date || b instanceof Date) {
    return (
      a instanceof Date && b instanceof Date && a.getTime() === b.getTime()
    );
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    return a.every((value, index) => deepEqual(value, b[index]));
  }
  if (typeof a === "object" && typeof b === "object" && a != null && b != null) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((key) =>
      deepEqual((a as Row)[key], (b as Row)[key]),
    );
  }
  return false;
}

function rowsOf(doc: unknown, key: string): Row[] {
  const value = (doc as Row | null | undefined)?.[key];
  return Array.isArray(value) ? (value as Row[]) : [];
}

function rowId(row: Row, idKey: string): string | null {
  const id = row[idKey];
  return typeof id === "string" && id !== "" ? id : null;
}

export function getAtPath(
  doc: unknown,
  path: string,
  collections: CollectionSpec = {},
): unknown {
  const [head, ...rest] = path.split(".");
  const spec = collections[head];
  if (!spec) {
    return rest.reduce<unknown>(
      (current, segment) => (current as Row | null | undefined)?.[segment],
      (doc as Row | null | undefined)?.[head],
    );
  }
  const [idSegment, ...leafSegments] = rest;
  const rows = rowsOf(doc, head);
  if (idSegment === ORDER_SEGMENT) {
    return rows.map((row) => rowId(row, spec.idKey));
  }
  const row = rows.find((candidate) => rowId(candidate, spec.idKey) === idSegment);
  return leafSegments.reduce<unknown>(
    (current, segment) => (current as Row | null | undefined)?.[segment],
    row,
  );
}

export function setAtPath<T>(
  doc: T,
  path: string,
  value: unknown,
  collections: CollectionSpec = {},
): T {
  const [head, ...rest] = path.split(".");
  const spec = collections[head];
  if (!spec || rest.length === 0) {
    if (rest.length > 0) {
      throw new Error(`Nested non-collection paths are not supported: ${path}`);
    }
    return { ...(doc as Row), [head]: value } as T;
  }
  const [idSegment, ...leafSegments] = rest;
  if (idSegment === ORDER_SEGMENT || leafSegments.length !== 1) {
    throw new Error(`setAtPath only writes scalar fields and row leaves: ${path}`);
  }
  const rows = rowsOf(doc, head);
  return {
    ...(doc as Row),
    [head]: rows.map((row) =>
      rowId(row, spec.idKey) === idSegment
        ? { ...row, [leafSegments[0]]: value }
        : row,
    ),
  } as T;
}

/**
 * Paths at which `b` differs from `a`. Collection rows diff by id: a row
 * present on one side only yields a whole-row path; rows on both sides yield
 * per-leaf paths; a changed relative order of shared rows yields `$order`.
 */
export function diffDocs(
  a: unknown,
  b: unknown,
  collections: CollectionSpec = {},
): Set<string> {
  const paths = new Set<string>();
  const keys = new Set([
    ...Object.keys((a as Row | null | undefined) ?? {}),
    ...Object.keys((b as Row | null | undefined) ?? {}),
  ]);

  for (const key of keys) {
    const spec = collections[key];
    if (!spec) {
      if (!deepEqual((a as Row | null)?.[key], (b as Row | null)?.[key])) {
        paths.add(key);
      }
      continue;
    }

    const aRows = rowsOf(a, key);
    const bRows = rowsOf(b, key);
    const aById = new Map(
      aRows.flatMap((row) => {
        const id = rowId(row, spec.idKey);
        return id ? [[id, row] as const] : [];
      }),
    );
    const bById = new Map(
      bRows.flatMap((row) => {
        const id = rowId(row, spec.idKey);
        return id ? [[id, row] as const] : [];
      }),
    );

    for (const [id, aRow] of aById) {
      const bRow = bById.get(id);
      if (!bRow) {
        paths.add(`${key}.${id}`);
        continue;
      }
      const leafKeys = new Set([...Object.keys(aRow), ...Object.keys(bRow)]);
      for (const leaf of leafKeys) {
        if (!deepEqual(aRow[leaf], bRow[leaf])) {
          paths.add(`${key}.${id}.${leaf}`);
        }
      }
    }
    for (const id of bById.keys()) {
      if (!aById.has(id)) paths.add(`${key}.${id}`);
    }

    const sharedInA = [...aById.keys()].filter((id) => bById.has(id));
    const sharedInB = [...bById.keys()].filter((id) => aById.has(id));
    if (sharedInA.join("\0") !== sharedInB.join("\0")) {
      paths.add(`${key}.${ORDER_SEGMENT}`);
    }
  }

  return paths;
}

/**
 * The rebase primitive: returns `base` with the values at `paths` copied from
 * `source`. Whole-row paths upsert (or, if absent in source, remove) the row;
 * leaf paths never resurrect a row that is gone from `base`; `$order` applies
 * source's relative order to the rows present in `base`.
 */
export function applyPaths<T>(
  base: T,
  paths: Iterable<string>,
  source: T,
  collections: CollectionSpec = {},
): T {
  let result = base as Row;
  const leafPaths: string[] = [];
  const orderPaths: string[] = [];
  const rowPaths: string[] = [];
  const scalarPaths: string[] = [];

  for (const path of paths) {
    const [head, idSegment, ...leafSegments] = path.split(".");
    if (!collections[head]) {
      scalarPaths.push(head);
    } else if (idSegment === ORDER_SEGMENT) {
      orderPaths.push(path);
    } else if (leafSegments.length === 0) {
      rowPaths.push(path);
    } else {
      leafPaths.push(path);
    }
  }

  for (const path of scalarPaths) {
    result = { ...result, [path]: (source as Row)[path] };
  }

  for (const path of rowPaths) {
    const [key, id] = path.split(".");
    const spec = collections[key];
    const sourceRow = rowsOf(source, key).find(
      (row) => rowId(row, spec.idKey) === id,
    );
    const baseRows = rowsOf(result, key);
    const exists = baseRows.some((row) => rowId(row, spec.idKey) === id);
    if (sourceRow) {
      result = {
        ...result,
        [key]: exists
          ? baseRows.map((row) =>
              rowId(row, spec.idKey) === id ? sourceRow : row,
            )
          : [...baseRows, sourceRow],
      };
    } else if (exists) {
      result = {
        ...result,
        [key]: baseRows.filter((row) => rowId(row, spec.idKey) !== id),
      };
    }
  }

  for (const path of leafPaths) {
    const [key, id, ...leafSegments] = path.split(".");
    const spec = collections[key];
    const leaf = leafSegments.join(".");
    const sourceRow = rowsOf(source, key).find(
      (row) => rowId(row, spec.idKey) === id,
    );
    const baseRows = rowsOf(result, key);
    const baseRow = baseRows.some((row) => rowId(row, spec.idKey) === id);
    if (!sourceRow || !baseRow) continue;
    result = {
      ...result,
      [key]: baseRows.map((row) =>
        rowId(row, spec.idKey) === id
          ? { ...row, [leaf]: sourceRow[leaf] }
          : row,
      ),
    };
  }

  for (const path of orderPaths) {
    const [key] = path.split(".");
    const spec = collections[key];
    const baseRows = rowsOf(result, key);
    const baseIds = new Set(
      baseRows.flatMap((row) => rowId(row, spec.idKey) ?? []),
    );
    const orderedIds = rowsOf(source, key)
      .flatMap((row) => rowId(row, spec.idKey) ?? [])
      .filter((id) => baseIds.has(id));
    const byId = new Map(
      baseRows.flatMap((row) => {
        const id = rowId(row, spec.idKey);
        return id ? [[id, row] as const] : [];
      }),
    );
    const ordered = orderedIds.map((id) => byId.get(id) as Row);
    const remaining = baseRows.filter((row) => {
      const id = rowId(row, spec.idKey);
      return id == null || !orderedIds.includes(id);
    });
    result = { ...result, [key]: [...ordered, ...remaining] };
  }

  return result as T;
}
