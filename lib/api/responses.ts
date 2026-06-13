import { NextResponse } from "next/server";

export function jsonError<TExtra extends Record<string, unknown> = Record<string, never>>(
  message: string,
  status = 400,
  extra?: TExtra,
) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

export function jsonNotFound(message = "Not found") {
  return jsonError(message, 404);
}

export function jsonSuccess() {
  return NextResponse.json({ success: true });
}

export function jsonOk<TExtra extends Record<string, unknown> = Record<string, never>>(
  extra?: TExtra,
) {
  return NextResponse.json({ ok: true, ...extra });
}

export function jsonFlag<TName extends string>(name: TName, value = true) {
  return NextResponse.json({ [name]: value } as Record<TName, boolean>);
}

export function jsonCreated<TBody>(body: TBody) {
  return NextResponse.json(body, { status: 201 });
}

/**
 * Optimistic-concurrency conflict: the caller's expectedVersion is stale.
 * `current` carries the fresh full document so the client can rebase and
 * retry. `conflict: true` distinguishes this from other 409s.
 */
export function jsonConflict<TCurrent>(message: string, current: TCurrent) {
  return NextResponse.json(
    { error: message, conflict: true, current },
    { status: 409 },
  );
}
