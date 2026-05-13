import { EventEmitter } from "node:events";
import { expect, test } from "@playwright/test";
import { attachPoolErrorHandler } from "@/lib/db";

class FakePool extends EventEmitter {}

test("attaches a database pool error listener once", () => {
  const pool = new FakePool();

  attachPoolErrorHandler(pool);
  attachPoolErrorHandler(pool);

  expect(pool.listenerCount("error")).toBe(1);
});

test("handles database pool errors without throwing from the emitter", () => {
  const pool = new FakePool();

  attachPoolErrorHandler(pool);

  expect(() => {
    pool.emit("error", Object.assign(new Error("raw connection details"), { code: "57P01" }));
  }).not.toThrow();
});
