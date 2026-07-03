# ADR-0003: Cure Readiness Warns Before Blocking

Status: Accepted
Date: 2026-06-17

## Context

Some Paonia-style materials or lots need time to cure/rest before use. Katana
does not provide a comparable soil-curing concept, so this is local product
intent rather than a reference-system choice.

The key decision is whether using an under-cured lot should be blocked or
warned.

## Decision

The system should track and display readiness status for cure/rest constraints.
When a user tries to consume or use an under-cured lot, default to a clear
warning with override rather than a hard block.

Hard blocking remains available only if a later product decision says the action
would create unsafe, unsellable, or impossible state.

## Consequences

- Operators can proceed when reality demands it, while still seeing the quality
  risk.
- The app must make readiness visible enough that warnings are not hidden
  surprises.
- Generated invariants should distinguish "readiness is tracked/displayed" from
  "under-cured use is forbidden."

## Principle Links

- P1. Integrity Laws Beat Workflow Freedom
- P3. Warn Before Blocking When Quality Is Degraded, Not Invalid
- P4. External References Inform Choices, Not Laws

## Exceptions / Review Triggers

Revisit if Paonia determines under-cured use ruins the batch, makes it
unsellable, or creates a safety/compliance issue.
