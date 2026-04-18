#!/usr/bin/env tsx
/**
 * Rewrites drizzle-kit-generated migration SQL so every statement is safe to
 * re-run. Drizzle emits raw CREATE / ADD CONSTRAINT / CREATE POLICY without
 * IF NOT EXISTS guards, which breaks production deploys any time prior state
 * leaks in (preview DB sharing, partial apply, manual SQL, etc.).
 *
 * Run after `drizzle-kit generate`, or standalone to backfill older files.
 *
 * Usage:
 *   tsx scripts/make-migrations-idempotent.ts           # rewrite drizzle/*.sql
 *   tsx scripts/make-migrations-idempotent.ts --check   # exit 1 if any file would change
 *
 * The rewriter is itself idempotent — running it a second time is a no-op.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(process.cwd(), "drizzle");
const BREAKPOINT = "--> statement-breakpoint";

function addIfNotExists(statement: string): string {
  let out = statement;
  out = out.replace(/(^|\s)CREATE SCHEMA (?!IF NOT EXISTS)/i, "$1CREATE SCHEMA IF NOT EXISTS ");
  out = out.replace(/(^|\s)CREATE TABLE (?!IF NOT EXISTS)/i, "$1CREATE TABLE IF NOT EXISTS ");
  out = out.replace(
    /(^|\s)CREATE (UNIQUE )?INDEX (?!IF NOT EXISTS)/i,
    (_m, lead, uniq) => `${lead}CREATE ${uniq ?? ""}INDEX IF NOT EXISTS `
  );
  out = out.replace(/ADD COLUMN (?!IF NOT EXISTS)/gi, "ADD COLUMN IF NOT EXISTS ");
  out = out.replace(/DROP COLUMN (?!IF EXISTS)/gi, "DROP COLUMN IF EXISTS ");
  return out;
}

function findPolicyTarget(statement: string): { name: string; table: string } | null {
  const match = statement.match(/^CREATE POLICY "([^"]+)" ON ("[^"]+"(?:\."[^"]+")?)/i);
  if (!match) return null;
  return { name: match[1], table: match[2] };
}

function findConstraintTarget(statement: string): { table: string; name: string } | null {
  const match = statement.match(
    /^ALTER TABLE ("[^"]+"(?:\."[^"]+")?) ADD CONSTRAINT "([^"]+)"/i
  );
  if (!match) return null;
  return { table: match[1], name: match[2] };
}

function hasMatchingDropPolicy(prev: string, policy: { name: string; table: string }): boolean {
  const pattern = new RegExp(
    `DROP POLICY IF EXISTS "${escapeRegex(policy.name)}" ON ${escapeRegex(policy.table)}`,
    "i"
  );
  return pattern.test(prev);
}

function hasMatchingDropConstraint(
  prev: string,
  constraint: { table: string; name: string }
): boolean {
  const pattern = new RegExp(
    `ALTER TABLE ${escapeRegex(constraint.table)} DROP CONSTRAINT IF EXISTS "${escapeRegex(
      constraint.name
    )}"`,
    "i"
  );
  return pattern.test(prev);
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function rewriteSql(sql: string): string {
  const segments = sql.split(BREAKPOINT);
  const output: string[] = [];

  for (let i = 0; i < segments.length; i++) {
    const raw = segments[i];
    const trimmed = raw.trim();
    if (!trimmed) {
      output.push(raw);
      continue;
    }

    const rewritten = addIfNotExists(raw);
    const statement = rewritten.trim();
    const prev = output.length > 0 ? output[output.length - 1] : "";

    const policy = findPolicyTarget(statement);
    if (policy && !hasMatchingDropPolicy(prev, policy)) {
      output.push(` DROP POLICY IF EXISTS "${policy.name}" ON ${policy.table};`);
      output.push(rewritten);
      continue;
    }

    const constraint = findConstraintTarget(statement);
    if (constraint && !hasMatchingDropConstraint(prev, constraint)) {
      output.push(
        ` ALTER TABLE ${constraint.table} DROP CONSTRAINT IF EXISTS "${constraint.name}";`
      );
      output.push(rewritten);
      continue;
    }

    output.push(rewritten);
  }

  return output.join(BREAKPOINT);
}

function main() {
  const check = process.argv.includes("--check");
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
  let changed = 0;
  const diverged: string[] = [];

  for (const file of files) {
    const path = join(MIGRATIONS_DIR, file);
    const original = readFileSync(path, "utf8");
    const next = rewriteSql(original);
    if (next !== original) {
      changed += 1;
      diverged.push(file);
      if (!check) {
        writeFileSync(path, next);
      }
    }
  }

  if (check) {
    if (changed > 0) {
      console.error(`Non-idempotent migrations detected (${changed}):`);
      for (const f of diverged) console.error(`  - ${f}`);
      console.error(
        "Run `pnpm db:generate` (or `tsx scripts/make-migrations-idempotent.ts`) to fix."
      );
      process.exit(1);
    }
    console.log(`All ${files.length} migration file(s) are idempotent.`);
    return;
  }

  if (changed === 0) {
    console.log(`All ${files.length} migration file(s) already idempotent.`);
    return;
  }

  console.log(`Rewrote ${changed} migration file(s):`);
  for (const f of diverged) console.log(`  - ${f}`);
}

main();
