---
title: Testing
description: How ERP changes should be verified with real workflow checks and Playwright lanes.
section: Developer
order: 630
---

## Purpose

ERP behavior can compile and still be operationally wrong. Tests should verify the real workflow, database state, and user-visible result.

## Test model

Use Playwright lanes for app behavior. Prefer real DB assertions over mocks. Inventory-affecting changes also need inventory verification.

## Workflow checks

For UI changes, use the feature in a browser. For domain changes, exercise the mutation path and inspect the dependent state: balances, lots, ledger entries, commitments, expected supply, statuses, and deleted records.

## PR evidence

Record the validation that ran. Include build, lint, relevant Playwright lanes, and inventory verification when applicable.
