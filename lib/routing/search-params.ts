type SearchParamPrimitive = string | number | bigint | boolean;

export type SearchParamRecord = Record<
  string,
  SearchParamPrimitive | readonly SearchParamPrimitive[] | undefined | null
>;

type SearchParamValue = SearchParamRecord[string];

export function firstSearchParamValue(value: SearchParamValue) {
  const first = Array.isArray(value) ? value[0] : value;
  return first == null ? undefined : String(first);
}

export function searchParamValues(value: SearchParamValue) {
  if (Array.isArray(value)) return value.map(String);
  return value == null ? [] : [String(value)];
}

export function buildSearchParams(searchParams: SearchParamRecord) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (Array.isArray(value)) {
      for (const entry of value) params.append(key, String(entry));
    } else if (value != null) {
      params.set(key, String(value));
    }
  }
  return params;
}

export function updateSearchParams(
  searchParams: URLSearchParams | string,
  updates: SearchParamRecord
) {
  const params = new URLSearchParams(searchParams.toString());
  for (const [key, value] of Object.entries(updates)) {
    params.delete(key);
    if (Array.isArray(value)) {
      for (const entry of value) params.append(key, String(entry));
    } else if (value != null) {
      params.set(key, String(value));
    }
  }
  return params;
}

export function appendSearchParams(path: string, searchParams: SearchParamRecord) {
  const params = buildSearchParams(searchParams);
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

export function requestUrl(request: Request) {
  return new URL(request.url);
}

export function requestSearchParams(request: Request) {
  return requestUrl(request).searchParams;
}

export function requestSearchParamRecord(request: Request) {
  return Object.fromEntries(requestSearchParams(request).entries());
}
