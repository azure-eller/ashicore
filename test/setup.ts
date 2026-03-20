import fs from "node:fs";
import path from "node:path";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";

afterEach(() => {
  cleanup();
});

// Route all fetch calls with relative URLs to the real dev server with auth.
// The form does fetch("/api/items", ...) — this makes it hit localhost:3000.
const envPath = path.resolve(__dirname, ".test-env.json");
if (fs.existsSync(envPath)) {
  const env = JSON.parse(fs.readFileSync(envPath, "utf-8"));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === "string" && input.startsWith("/")) {
      input = `${env.TEST_BASE_URL}${input}`;
      init = {
        ...init,
        headers: {
          ...Object.fromEntries(new Headers(init?.headers).entries()),
          Cookie: env.TEST_SESSION_COOKIE,
          Origin: env.TEST_BASE_URL,
        },
      };
    }
    return originalFetch(input, init);
  }) as typeof fetch;
}

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

if (!("ResizeObserver" in globalThis)) {
  globalThis.ResizeObserver = ResizeObserverMock as typeof ResizeObserver;
}

if (!("PointerEvent" in globalThis)) {
  globalThis.PointerEvent = MouseEvent as typeof PointerEvent;
}

if (!window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

if (!HTMLElement.prototype.scrollIntoView) {
  HTMLElement.prototype.scrollIntoView = vi.fn();
}

if (!HTMLElement.prototype.hasPointerCapture) {
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
}

if (!HTMLElement.prototype.setPointerCapture) {
  HTMLElement.prototype.setPointerCapture = vi.fn();
}

if (!HTMLElement.prototype.releasePointerCapture) {
  HTMLElement.prototype.releasePointerCapture = vi.fn();
}
