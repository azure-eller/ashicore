"use client";

/**
 * Cosmetic URL reflection for inline-create cards after controller state has
 * already adopted the persisted ID. This is not a Next route transition, and
 * callers must not rely on it to reinitialize page data.
 */
export function reflectPersistedCardUrlWithoutNavigation(href: string) {
  window.history.replaceState(null, "", href);
}
