# Triage

Triage is a self-hosted SvelteKit webmail triage application that keeps architecture simple and UX fast:

- Multi-account IMAP + SMTP
- SQLite cache for folders/messages/suggestions/actions
- Review-first AI suggestions (never auto-send / never auto-delete)
- MCP endpoint for external agent tooling
- Single Node process, single Docker container

---

## 1) Architecture

### Runtime stack

- SvelteKit + `@sveltejs/adapter-node`
- Node.js server process (`node build`)
- SQLite (`better-sqlite3`) + Drizzle ORM
- IMAP via `imapflow`
- SMTP via `nodemailer`

### AI stack

- Primary: DeepSeek (`AI_PROVIDER=deepseek`)
- Primary model default: `deepseek-v4-flash`
- Fallback: Gemini via OpenAI-compatible endpoint
- Zod schema validation on model output
- One JSON repair attempt before fallback

### Data + files

- Database default: `/data/triage.db`
- Override path: `DB_PATH`
- Memory file: `/data/AGENT_INSTRUCTIONS.md`

---

## 2) Feature status

### Implemented

- Multi-account add/list/test/enable/disable/remove
- Sync status + last sync timestamps per account
- IMAP backfill + active inbox watch loop using IMAP IDLE
- SMTP send for reply/forward actions
- Action execution audit log
- FTS5-backed message search with automatic LIKE fallback
- Safe HTML rendering mode for email bodies (sanitized server-side)
- Memory editor for `AGENT_INSTRUCTIONS.md`
- Webhook delegate execution with optional signature
- MCP endpoint with auth token

### Safety guarantees

- Actions execute only after explicit user click
- No automatic model action execution
- No permanent delete in v1 (delete routes to Trash when available)
- Secrets never exposed to browser JS

---

## 3) Git-first setup (detailed)

### Fresh clone

```bash
git clone <your-repo-url> triage
cd triage
npm install
# create .env manually from the template in section 4
npm run dev
```

### First-time repo setup checklist

1. Create `.env` at the repo root.
2. Set `APP_PASSWORD`, `APP_SESSION_SECRET`, `ENCRYPTION_KEY`, and `MCP_AUTH_TOKEN`.
3. Set `AI_API_KEY` for DeepSeek (and optional Gemini fallback vars).
4. Start dev server with `npm run dev`.
5. Sign in at `/login` with `APP_PASSWORD`.

### Daily feature branch workflow

```bash
# make sure main is current
git checkout main
git pull --ff-only

# create branch
git checkout -b feat/<short-description>

# develop
npm run check
npm run test:unit

# commit
git add -A
git commit -m "feat: <summary>"

# push
git push -u origin feat/<short-description>
```

### Review + commit discipline

```bash
# inspect staged and unstaged deltas
git status
git diff
git diff --staged

# stage intentionally
git add <paths>

# re-check before commit
npm run check
npm run test:unit

git commit -m "feat: <summary>"
```

### Keep branch up to date with main

```bash
git fetch origin
git checkout feat/<short-description>
git merge origin/main
```

### Resolve merge conflicts safely

```bash
# after merge reports conflicts
git status
# edit conflicting files, then:
git add <resolved-files>
git commit
```

Use `npm run check` and `npm run test:unit` immediately after resolving conflicts.

### Rebase alternative (clean history)

```bash
git fetch origin
git checkout feat/<short-description>
git rebase origin/main
```

If conflicts occur during rebase:

```bash
git status
# resolve files
git add <resolved-files>
git rebase --continue
```

Abort rebase if needed:

```bash
git rebase --abort
```

### Prepare for PR merge

```bash
npm run check
npm run test:unit
npm run test:e2e
npm run eval:ai
npm run build
docker build -t triage .
```

### Tagged release flow

```bash
git checkout main
git pull --ff-only
git tag -a v1.0.0 -m "Triage v1.0.0"
git push origin v1.0.0
```

### Syncing a deployed host from Git

```bash
git fetch origin
git checkout main
git pull --ff-only
npm install
npm run build
docker compose up --build -d
```

---

## 4) Environment variables

Create a repo-root `.env`:

```env
# App
NODE_ENV=development
PORT=3000
DATA_DIR=/data
DB_PATH=/data/triage.db

# Security
APP_SESSION_SECRET=
APP_PASSWORD=
ENCRYPTION_KEY=
MCP_AUTH_TOKEN=

# Primary AI provider: DeepSeek
AI_PROVIDER=deepseek
AI_MODEL=deepseek-v4-flash
AI_BASE_URL=https://api.deepseek.com
AI_API_KEY=

# Fallback AI provider: Gemini OpenAI-compatible API
AI_FALLBACK_PROVIDER=gemini
AI_FALLBACK_MODEL=
AI_FALLBACK_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/
AI_FALLBACK_API_KEY=

AI_MAX_REPAIR_ATTEMPTS=1
DEBUG_AI=false

# Optional live IMAP account for real sync testing
IMAP_HOST=
IMAP_PORT=993
IMAP_USERNAME=
IMAP_PASSWORD=

SMTP_HOST=
SMTP_PORT=465
SMTP_USERNAME=
SMTP_PASSWORD=

# Optional test account identity
TEST_EMAIL_FROM=
TEST_EMAIL_TO=
```

### Production secret requirements

Startup fails in production if any are missing:

- `APP_SESSION_SECRET`
- `APP_PASSWORD`
- `ENCRYPTION_KEY`
- `MCP_AUTH_TOKEN`
- `AI_API_KEY`

### Development behavior

If `ENCRYPTION_KEY` is not set in development, Triage logs a warning and uses a temporary dev-only key.

---

## 5) Local run

```bash
npm install
npm run dev
```

Default local URL: `http://localhost:5173`

The UI is password-gated:

- uses `APP_PASSWORD` when set
- dev fallback password is `password` only when unset

---

## 6) Docker run

### Docker Compose (recommended)

```bash
docker compose up --build
```

### Direct Docker run

```bash
docker build -t triage .
docker run \
  -p 3000:3000 \
  -v triage-data:/data \
  --env-file .env \
  triage
```

Volume mount `/data` persists:

- `triage.db`
- `AGENT_INSTRUCTIONS.md`

---

## 7) Accounts: add/test/disable/remove

In-app path:

- Open `Accounts` view from the left nav.

Supported operations:

1. Add IMAP + SMTP account
2. Test connectivity (`POST /api/accounts/:id/test`)
3. Disable sync (`POST /api/accounts/:id/disable`)
4. Re-enable sync (`POST /api/accounts/:id/enable`)
5. Remove account (`DELETE /api/accounts/:id`)

Delete semantics:

- Active worker stopped
- Account + folders + cached messages removed
- Related suggestions, feedback, and executed actions removed

Passwords:

- encrypted at rest
- never shown after save
- never logged

---

## 8) AI configuration

### DeepSeek primary

```env
AI_PROVIDER=deepseek
AI_MODEL=deepseek-v4-flash
AI_BASE_URL=https://api.deepseek.com
AI_API_KEY=<deepseek-key>
```

### Gemini fallback

```env
AI_FALLBACK_PROVIDER=gemini
AI_FALLBACK_MODEL=<your-model-name>
AI_FALLBACK_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/
AI_FALLBACK_API_KEY=<gemini-key>
```

Behavior summary:

- Primary provider called first
- If malformed output: one repair attempt
- If primary fails: fallback provider (if configured)
- If all fail: safe error suggestion saved, no action executed

---

## 9) Search behavior

- Primary path: SQLite FTS5 index over subject/sender/recipients/body
- Fallback path: LIKE search if FTS is unavailable or query parsing fails

This keeps search fast in normal deployments and still reliable on constrained SQLite builds.

---

## 10) Email body rendering

Reader pane supports:

- `HTML` mode: server-sanitized rich body
- `Text` mode: plain body text

Sanitization is done server-side before rendering to the browser.

### Inbox ergonomics

- Account filter in the left pane (`All accounts` or per account)
- Keyboard shortcuts:
  - `/` focuses search
  - `j` / `k` moves message selection

---

## 11) Memory editor

Memory file:

- `/data/AGENT_INSTRUCTIONS.md`

Usage:

- edited in-app
- included in every triage prompt
- affects future suggestion tone/rules/routing

---

## 12) MCP usage

Endpoint:

```text
/api/mcp/sse
```

Auth:

```http
Authorization: Bearer ${MCP_AUTH_TOKEN}
```

Supported tools:

- `search_emails` with `{ "query": "..." }`
- `get_email_context` with `{ "message_id": "..." }`

---

## 13) Scripts

```json
{
  "dev": "vite dev --host 0.0.0.0",
  "build": "vite build",
  "preview": "node build",
  "check": "svelte-kit sync && svelte-check --tsconfig ./tsconfig.json",
  "lint": "eslint .",
  "test": "npm run test:unit && npm run test:e2e",
  "test:unit": "vitest run",
  "test:e2e": "playwright test",
  "eval:ai": "tsx scripts/eval-ai.ts",
  "db:push": "drizzle-kit push",
  "db:studio": "drizzle-kit studio"
}
```

---

## 14) Validation checklist

```bash
npm run check
npm run lint
npm run test:unit
npm run test:e2e
npm run eval:ai
npm run build
docker build -t triage .
```

---

## 15) Security notes

- HTTP-only same-site auth cookie
- CSRF token required for JSON mutation endpoints
- Credentials encrypted with `ENCRYPTION_KEY`
- `MCP_AUTH_TOKEN` required for MCP endpoint
- Webhook payloads signed when webhook secret exists
- Raw model outputs stored only when `DEBUG_AI=true`

---

## 16) Troubleshooting

### `401` from DeepSeek during eval/runtime

Cause:

- invalid or expired `AI_API_KEY`

Actions:

1. Verify key in `.env`
2. Re-run `npm run eval:ai`
3. Configure Gemini fallback so production suggestions continue

### No new mail appears

Actions:

1. Use account `Test` button
2. Confirm account is `enabled`
3. Check sync status/error in Accounts view
4. Confirm IMAP server supports IDLE

### Search seems empty

Actions:

1. Check if messages are present in Inbox
2. Use simple single-word terms first
3. If FTS unavailable in environment, LIKE fallback still works but may be slower

### Container starts but no persistence

Cause:

- `/data` not mounted

Action:

- add `-v triage-data:/data` or compose volume

---

## 17) Intentional constraints

These are by design, not bugs:

- No automatic send/reply/forward/delete
- Delete action is non-destructive (Trash move only)
- Human approval required for all executions
