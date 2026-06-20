# 07 — Integrations Guide

Every external service integration — how it connects, what it syncs, and the API flow.

## Integration Overview

| Integration | Auth Method | Sync Direction | Primary Use |
|-------------|-------------|----------------|-------------|
| Jira | API Token | Bidirectional | Pull assigned issues, push status |
| GitHub | Personal Access Token | Bidirectional | Pull issues, create PRs, link branches |

---

## Jira Integration (Detailed)

### Authentication

```bash
todo jira auth
```

Interactive setup wizard prompts for: Atlassian domain, email address, API token. Verifies credentials, then configures status mapping (Jira statuses to local statuses).

Credentials go to OS keychain via keytar. Config goes to integration_config table.

### API Endpoints Used

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/rest/api/3/myself` | GET | Verify auth, get account ID |
| `/rest/api/3/search` | POST | JQL search for assigned issues |
| `/rest/api/3/issue/{key}` | GET | Get single issue details |
| `/rest/api/3/issue/{key}` | PUT | Update issue fields |
| `/rest/api/3/issue/{key}/transitions` | GET | Get available transitions |
| `/rest/api/3/issue/{key}/transitions` | POST | Transition issue status |

### Pull Flow

```
todo jira pull --sprint current
  |
  v
Build JQL: "assignee = currentUser() AND sprint in openSprints()"
  |
  v
POST /rest/api/3/search (paginated, 50 per request)
  |
  v
For each issue:
  +-- Check if jira_key exists in local DB
  |     +-- YES: Compare sync_hash
  |     |         +-- Hash matches: Skip (no changes)
  |     |         +-- Remote changed, local didn't: Update local
  |     |         +-- Both changed: Flag conflict
  |     +-- NO: Create new local task
  |
  +-- Map fields:
  |     summary -> title
  |     description -> description (markdown to plain text)
  |     priority.name -> priority (via mapping)
  |     status.name -> status (via config status_map)
  |     duedate -> due_date
  |     issuekey -> jira_key
  |
  +-- Compute sync_hash = SHA-256(title + status + priority + due)
  |
  v
Output: "Synced 12 tasks from BACKEND (3 new, 7 updated, 2 conflicts)"
```

### Push Flow

```
todo jira push 42
  |
  v
Load task #42, verify jira_key exists
  |
  v
Map local status to Jira transition
GET transitions, find matching transition ID
POST transition
  |
  v
Update sync_hash and last_synced_at locally
```

### Conflict Resolution

When both local and remote changed since last sync, shows a side-by-side diff. User picks: keep local, keep remote, or merge per field.

### Rate Limiting

Jira Cloud API: 100 requests/minute. Token bucket rate limiter in JiraClient. Progress bar for large syncs.

---

## GitHub Integration

### Authentication

GitHub Personal Access Token with scopes: `repo`, `read:org`.

### Features

- **Pull assigned issues:** `GET /user/issues?filter=assigned&state=open`
- **Create PR from task:** `POST /repos/{owner}/{repo}/pulls`
- **CI status:** `GET /repos/{owner}/{repo}/commits/{ref}/status`

---

## Health Monitoring

```bash
todo integrate status
```

Shows connection status, last sync time, and any errors for all configured integrations. Health checks run on app start (background, non-blocking).
