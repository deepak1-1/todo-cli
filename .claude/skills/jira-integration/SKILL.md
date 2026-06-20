---
name: jira-integration
description: Jira Cloud REST patterns for src/integrations/jira/. Use for jira_pull / jira_push intents and the `todo jira` subcommand.
---

# Jira integration

## Auth
- API token + email via `CredentialStore` (`src/plugins/credential-store.ts`). Basic auth header: `Authorization: Basic base64(email:token)`.
- Never read tokens from env in command code — go through the store. Tokens at rest are encrypted there.
- Never log tokens, even at debug level. Redact on serialization.

## Rate limits
- Jira Cloud: ~900 req/hr/user. Treat 429 as authoritative; honor `Retry-After`.
- Batch pulls with JQL `ORDER BY updated DESC` + `expand=names` and page through `startAt`/`maxResults` (≤100). Stop early once you hit already-synced keys.

## Round-trip identity
- Local task carries `jira_key` (e.g. `PROJ-123`) and `jira_id`. Use `jira_key` for display, `jira_id` for API calls (it's stable across rename).
- `sync_hash` is the SHA of the canonical Jira payload at last sync — use it to detect remote drift before pushing local edits.
- `last_synced_at` is the high-water mark for incremental pulls (`updated >= last_synced_at`).

## Mapping
Status, priority, and assignee mappings are integration-specific concerns and belong in `src/integrations/jira/jira-client.ts`, not in `src/core/`. Core stays Jira-unaware.

## Interface contract
The integration implements `IntegrationProvider` from `src/plugins/types.ts`. Read-only deployments may stub `push()` but must throw `NotImplementedError` with a clear message — not silently no-op.

## Error surface
Network and HTTP errors become typed errors (`JiraAuthError`, `JiraNotFoundError`, `JiraRateLimitError`) and bubble to the command layer, which translates them to user-facing strings via `src/utils/format.ts`.

## Testing
Don't hit live Jira from tests. Mock `fetch` at the `jira-client.ts` boundary. Record one fixture per response shape under `tests/integrations/jira/__fixtures__/`.
