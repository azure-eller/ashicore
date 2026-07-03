# ADR-0002: Unchanged BOM Saves Are No-Ops

Status: Accepted
Date: 2026-06-17

## Context

BOMs use append-only revision history. That architecture creates a question
Katana-style in-place recipe editing does not face: what should happen when a
user saves a BOM revision payload that is equivalent to the current revision?

The options are: append a duplicate revision, reject the save, or no-op.

## Decision

Treat an unchanged BOM revision save as an idempotent no-op. Do not append a
duplicate revision and do not show a user-facing error solely because nothing
changed.

## Consequences

- Revision history remains meaningful: a new revision means business payload
  changed.
- The user is not punished for an accidental or repeated save.
- Harnesses should assert this behavior at the API/domain boundary.
- If a future explicit "checkpoint" feature exists, it must be modeled as a
  separate product decision rather than overloading normal save.

## Principle Links

- P2. Preserve History; Append Meaningful Change
- P3. Warn Before Blocking When Quality Is Degraded, Not Invalid

## Exceptions / Review Triggers

Revisit only if users need an explicit audited checkpoint even when BOM payloads
are unchanged.
