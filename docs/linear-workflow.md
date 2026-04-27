---
read_when:
  - Starting non-trivial coding work
  - Planning or triaging agent work
  - Importing GitHub pull requests into Linear
  - Opening, reviewing, or merging pull requests
---

# Linear Workflow

Linear owns intent, scope, status, and follow-up planning. GitHub owns the code review, CI, and merge record. Coding agents should keep both linked, but avoid duplicating long implementation detail in both places.

## Default Flow

1. Before coding, search Linear for an existing issue by feature name, PR URL, PR number, or branch name.
2. If none exists and the work is non-trivial, create one issue in team `Erp`.
3. Put acceptance criteria, constraints, and verification expectations in the Linear issue.
4. Create a dedicated worktree and branch that includes the issue ID, for example `codex/erp-123-short-slug`.
5. When a PR opens, attach the GitHub PR link to the issue and move the issue to `In Review`.
6. After merge and required cleanup, move the issue to `Done`.

Tiny mechanical fixes can skip Linear only when the change is obvious, low-risk, and part of the current conversation. If a fix grows beyond that, create the issue before continuing.

## Status Mapping

Use the existing `Erp` team statuses:

| Linear status | Use for |
|---------------|---------|
| `Backlog` | Imported ideas, parked PRs, work not ready to schedule |
| `Todo` | Chosen work that is ready to start |
| `In Progress` | Active branch/worktree work |
| `In Review` | Ready GitHub PR under review or waiting on CI |
| `Done` | Merged work with required cleanup complete |
| `Canceled` | Abandoned work |
| `Duplicate` | Work represented by another Linear issue |

## Importing Open GitHub PRs

When converting existing PRs into Linear issues:

- Search Linear first for the PR URL, PR number, and title.
- Create one Linear issue per PR.
- Title format: `PR #123: GitHub PR title`.
- Label every imported PR with `GitHub PR`.
- Attach the PR URL as a Linear link.
- Copy enough PR context to make the issue useful: status, branch, author, summary, validation, and known risks.
- Use `Backburner` + Low priority for parked draft PRs.
- Use Medium priority for normal ready PRs unless the user specifies otherwise.

Do not create a second Linear issue when an existing issue already links the PR. Update the existing issue instead.

## Agent Handoff Notes

A Linear issue should let a later agent restart without rereading the whole conversation. Keep the issue concise but include:

- Goal and acceptance criteria.
- Relevant routes, modules, or docs to read.
- Required commands, especially domain-specific tests.
- Links to GitHub PRs, design notes, or customer context.
- Current blocker or next action.

For large work, split Linear issues by independently reviewable PRs. Avoid one broad tracking issue that spans unrelated database, UI, and workflow changes unless it is only a parent planning issue.
