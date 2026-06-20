---
name: github-integration
description: GitHub REST/GraphQL patterns for src/integrations/github/. Use for github_pull / github_push intents and `todo github` subcommand.
---

# GitHub integration

## Auth
- Personal Access Token (fine-grained or classic) via `CredentialStore`.
- Header: `Authorization: Bearer <token>`, plus `X-GitHub-Api-Version: 2022-11-28`.
- Never `gh auth token` shelling out as a credential source from inside the integration — that bypasses the credential store and breaks for non-`gh` users.

## Rate limits
- Primary: 5000 req/hr for authenticated tokens. Check `X-RateLimit-Remaining` and back off when below ~10%.
- Secondary: undocumented per-resource limits. Treat any `403` with `Retry-After` as a secondary limit and sleep — do not retry tightly.
- Use conditional requests (`If-None-Match` with stored `ETag`) for poll-style sync to avoid burning quota.

## Round-trip identity
- Local task carries `github_ref` (e.g. `owner/repo#123`).
- For pull request links specifically, include the PR number; do not store the GraphQL node ID — it's unstable across migrations.
- `sync_hash` from the canonical issue payload guards against overwriting upstream edits.

## What to sync
Issues and PRs only. Discussions, comments, and reactions are out of scope unless explicitly added to `Intent`.

## Mapping
- GitHub `open`/`closed` → local `pending`/`done`. `in_progress` is local-only.
- Labels → tags (lowercase, kebab-case). Project name comes from repo name.
- Assignee mapping is single-user (the configured account); do not import all assignees.

## Interface contract
Implements `IntegrationProvider`. The GitHub plugin historically returned an empty array from `commands()` — that's valid and means "no extra subcommands"; document it explicitly so the `arch` LSP check doesn't flag it.

## Testing
Mock at the `fetch` boundary. Record one fixture per response shape. Do not hit `api.github.com` from CI.
