---
title: Why Workflow-First Docs
description: Why Ashicore documentation starts with business flows before module or API reference.
section: Design decisions
order: 410
---

## Decision

Ashicore docs should start from operator workflows, then link to concepts and reference.

## Reason

ERP users usually arrive with a job: receive this material, make this batch, ship this customer order, find this shortage, or delete this mistaken document. They do not begin with table names or module boundaries.

## Result

Start-here and how-to docs explain the real-world path. Concept docs explain the mental model. Reference docs define exact statuses, fields, transitions, and invariants. Developer docs preserve internal implementation constraints.

## Tradeoff

Some content is repeated at different depths. That is acceptable when each page answers a different user need.
