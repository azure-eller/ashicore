# Claude Plugin Directory Submission

Goal: get Ashicore available as a Claude plugin for Claude Code and Cowork users.

Official docs:
- Plugin submission: https://claude.com/docs/plugins/submit
- Plugin overview: https://claude.com/docs/plugins/overview
- Claude Code plugin guide: https://code.claude.com/docs/en/plugins

Submit forms:
- Claude.ai: https://claude.ai/settings/plugins/submit
- Console: https://platform.claude.com/plugins/submit

## Current Status

Have:
- Plugin source: `integrations/claude/ashicore-plugin`
- Plugin zip: `public/downloads/ashicore-claude-plugin.zip`
- Manifest: `.claude-plugin/plugin.json`
- Remote MCP reference: `.mcp.json`
- One skill: `production-schedule`

Need:
- Public GitHub repo or public path reviewers can inspect
- Run `claude plugin validate`
- README with install, setup, and usage
- Support and privacy links
- Test install in Claude Code
- Confirm MCP OAuth setup path from plugin

## Plugin Contents

Name:
ashicore

Description:
Ashicore production planning for Claude.

Components:
- MCP server reference: `https://ashicore.app/api/agent/mcp`
- Skill: `production-schedule`

Skill purpose:
When the user asks what to make each day or whether shipments will be missed, Claude calls Ashicore production data and returns a concise daily schedule with any shipment misses and what would need to happen to avoid each miss.

## Submission Checklist

- [ ] Plugin source is in a public GitHub repo or public reviewable location.
- [ ] `claude plugin validate` passes.
- [ ] Zip contains correct top-level structure.
- [ ] README explains what the plugin does.
- [ ] README explains how to connect Ashicore MCP.
- [ ] README links to privacy policy and support.
- [ ] Plugin tested in Claude Code.
- [ ] Plugin install flow documented with screenshots or exact commands.
- [ ] Related connector has been submitted or is already listed.
- [ ] Submit plugin directory form.

## Reviewer Instructions

1. Install the plugin from the provided GitHub repo or zip.
2. Restart Claude Code if prompted.
3. Connect the Ashicore MCP server.
4. Authenticate with the provided reviewer account.
5. Ask: “Create a production schedule for this week and show shipment misses.”

Expected behavior:
- Claude uses the Ashicore MCP server.
- Claude applies the `production-schedule` skill.
- Claude returns a daily schedule.
- Claude explicitly flags missed shipments and avoidance actions.

## Approval Risk

Main risks:
- The plugin depends on an unlisted remote MCP connector.
- Plugin source is not public enough for review.
- `claude plugin validate` fails.

Mitigation:
- Submit the Claude Connector Directory listing first.
- Keep the plugin source minimal and public.
- Keep the skill short.
