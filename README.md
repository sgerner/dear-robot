# Triage

Triage is a self-hosted SvelteKit webmail triage application that keeps architecture simple and UX fast:

- Multi-account IMAP + SMTP
- Folder-based email client controls
- SQLite cache for folders/messages/suggestions/actions
- Review-first AI suggestions (never auto-send / never auto-delete)
- Installable PWA with browser-side IndexedDB cache for recent working data
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
- Optional advanced planner profile for harder multi-step tasks
- Zod schema validation on model output
- One JSON repair attempt before fallback
- AI provider details are editable in the UI under Config -> AI Profiles
- Onboarding banner guides AI setup first, then email account setup

### Data + files

- Database default: `/data/triage.db`
- Override path: `DB_PATH`
- Memory file: `/data/AGENT_INSTRUCTIONS.md`

---

## 2) Feature status

### Implemented

- Multi-account add/list/test/enable/disable/remove
- Seeded demo mailbox auto-prunes when the first real mailbox is added
- Sync status + last sync timestamps per account
- IMAP backfill + active inbox watch loop using IMAP IDLE
- SMTP send for reply/forward actions
- Folder navigation, folder counts, and per-folder message filtering
- Move, star/unstar, mark read/unread
- Compose, reply, reply all, forward, cc, and bcc
- Attachment metadata parsing and authenticated attachment download endpoints
- Attach-to-send support in compose flows
- Persistent drafts with autosave
- Offline compose outbox queue with retry on reconnect
- Rich/plain compose modes with HTML fallback
- Bulk selection and bulk operations (read/unread, star/unstar, trash move)
- Conversation timeline using message/thread headers with subject fallback
- Address book/autocomplete from observed and manually used contacts
- Contact CSV import/export APIs and config-panel controls
- Action execution audit log
- FTS5-backed message search with automatic LIKE fallback
- Safe HTML rendering mode for email bodies (sanitized server-side)
- PWA manifest/service worker and local IndexedDB cache for messages/folders/contacts
- Memory editor for `AGENT_INSTRUCTIONS.md`
- Memory system with core profile, learned rules, examples, and event log
- Webhook delegate execution with optional signature
- MCP endpoint with auth token
- Incremental folder sync cursors + UIDVALIDITY tracking table
- Folder-role mapping for archive/spam/trash routing
- Best-effort sent folder append on IMAP accounts after SMTP send
- Agent task planning (action graph) per email with explicit approve/execute lifecycle
- Bring-your-own tool gateway (MCP HTTP + CLI) managed in UI
- Advanced-model routing for complex planning tasks (with fallback behavior)
- Task run + step + tool call audit persistence

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
3. Optionally set AI bootstrap defaults in `.env` if you want the first run to seed providers.
4. Start dev server with `npm run dev`.
5. Sign in at `/login` with `APP_PASSWORD`.
6. Open Config -> AI Profiles and save the provider, model, base URL, and API key for each profile you want active.
7. After the AI profiles are saved, add a real IMAP/SMTP account. The seeded demo mailbox is removed automatically the first time a real account is added.

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
# Optional bootstrap API key if you want the DB to seed with a live key on first boot
AI_API_KEY=

# Fallback AI provider: Gemini OpenAI-compatible API
AI_FALLBACK_PROVIDER=gemini
AI_FALLBACK_MODEL=
AI_FALLBACK_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/
AI_FALLBACK_API_KEY=

# Optional advanced planning model (for complex task plans)
AI_ADVANCED_PROVIDER=deepseek
AI_ADVANCED_MODEL=deepseek-v4-pro
AI_ADVANCED_BASE_URL=https://api.deepseek.com
AI_ADVANCED_API_KEY=

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

### 7b) Gmail OAuth From UI

You can connect Gmail without relying on `.env` OAuth keys:

1. Open `Accounts` view.
2. In `Connect Gmail (Google OAuth)`, enter:
   - Google OAuth Client ID
   - Google OAuth Client Secret
   - Redirect URI (typically `https://your-host/api/accounts/google/callback`)
   - Scopes (default includes `https://mail.google.com/`)
3. Click `Save OAuth Settings`.
4. Click `Connect Gmail Account` and complete Google consent.

After callback, the app saves the Gmail account with OAuth auth (`oauth_gmail`) and uses token refresh for IMAP/SMTP automatically.

---

## 8) AI configuration

AI settings are managed in the UI:

- Open `Config`
- Edit `AI Profiles`
- Save `Primary`, `Fallback`, and `Advanced` profiles as needed

Each profile supports:

- preset selectors for DeepSeek, Gemini, OpenAI, Anthropic, Vertex/Gemini, OpenRouter, and manual setup
- model, base URL, API key, and transport editing
- enabling/disabling without losing stored values

`.env` AI variables remain useful as bootstrap defaults for first-run seeding, but the app reads the saved profiles from SQLite at runtime.

Recommended starting points:

- Fast triage: `deepseek-v4-flash`
- Balanced default: `gemini-2.5-flash`
- Strong planning: `deepseek-v4-pro`
- Careful long-form drafting: `claude-sonnet-4`
- OpenAI-compatible general purpose: `gpt-4.1-mini`

Behavior summary:

- Primary profile called first
- If malformed output: one repair attempt
- If primary fails: fallback profile, if configured
- If all fail: safe error suggestion saved, no action executed

### 8c) Audio Dictation Profile

The app also supports an `audio` AI profile for voice-to-text:

- Configure it under `Config -> AI Profiles` (profile key: `audio`).
- Recommended model: `gpt-4o-mini-transcribe` (OpenAI-compatible audio endpoint).
- The UI shows a floating `Dictate` button when a text input or textarea is focused.
- Recording is transcribed server-side via `/api/audio/transcribe` and inserted at the cursor.

---

## 8b) Memory configuration

Memory now uses a layered model:

- Core Profile: compact always-on instructions
- Learned Rules: auto-promoted behavioral patterns from edits/regenerations
- Examples: compact before/after snapshots
- Advanced Memory File: optional direct editing of `/data/AGENT_INSTRUCTIONS.md` behind Advanced mode

In the `Memory` route:

- edit and save Core Profile
- review/remove learned rules
- optionally enable Advanced mode for direct file editing

Learning triggers:

- suggestion edit
- suggestion regenerate with note
- task planning prompt retrieval uses the same memory context

## 8d) AI Autopilot

The AI-first workflow is intentionally simple and inspectable:

- `Run Autopilot` scans recent mail.
- When enabled, the server also runs the same autopilot pass on a simple interval (`AUTOPILOT_INTERVAL_MINUTES`, default `15`).
- Existing and newly generated AI suggestions are placed into one approval queue.
- The queue supports bulk approve, reject, and execute.
- Sends, forwards, and delegation stay approval-gated by default.
- Optional low-risk auto-filing can be enabled in policy settings.
- Every AI call records provider/model/status/latency/prompt hash in `ai_observability`.
- Thread summaries, open questions, commitments, and follow-up reminders are stored in SQLite.

Autopilot tables:

- `agent_action_queue`
- `autopilot_runs`
- `ai_observability`
- `thread_summaries`
- `follow_up_reminders`
- `outcome_events`

The implementation plan is documented in `AI_AGENT_IMPLEMENTATION_PLAN.md`.

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
- Folder navigation with unread/total counts
- Compose drawer for new mail, reply, reply all, and forward
- Star, read/unread, move, and trash controls in the reading pane
- Keyboard shortcuts:
  - `/` focuses search
  - `c` opens compose
  - `j` / `k` moves message selection

## 10.1) PWA and Local Cache

The app includes:

- `/manifest.webmanifest`
- service worker asset caching
- standalone display mode for installable browser/PWA use
- IndexedDB database named `triage-client-cache`

The local cache stores recent message-list rows, folders, contacts, and cache metadata. It is intended for faster UI startup and PWA ergonomics; the server SQLite database remains authoritative.

Phase 2 adds:

- `outbox` queue storage for offline sends
- local draft cache snapshots alongside server-side persistent drafts

For Phase 1, this cache is sized for normal mailbox operation around 1000 indexed messages. Future phases can move heavier local search to OPFS SQLite if IndexedDB becomes limiting.

## 10.2) Email Client Roadmap

See [EMAIL_CLIENT_ROADMAP.md](./EMAIL_CLIENT_ROADMAP.md) for the phased plan beyond the implemented Phase 4 baseline, including deeper production hardening and richer AI workflows.

## 10.3) Agentic Operations

Phase 4 adds a task/action-graph layer:

- per-email task plans with ordered steps
- explicit step approval and task execution controls
- persistent status and outputs for each step

Bring-your-own tools:

- add tool definitions in Config view (`mcp_http` or `cli`)
- test/enable/disable/remove tools from UI
- task steps can call tools only through the gateway layer (audited)

Phase 4 route additions:

- `POST /api/messages/:id/plan`
- `GET /api/tasks`
- `GET /api/tasks/:id`
- `POST /api/tasks/:id/approve`
- `POST /api/tasks/:id/reject`
- `POST /api/tasks/:id/execute`
- `GET /api/tools`
- `POST /api/tools`
- `POST /api/tools/:id`
- `POST /api/tools/:id/test`
- `DELETE /api/tools/:id`

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

Connect from another agent/runtime:

1. Read available tools (SSE-ready payload):

```bash
curl -s \
  -H "Authorization: Bearer ${MCP_AUTH_TOKEN}" \
  http://localhost:3000/api/mcp/sse
```

2. Invoke a tool:

```bash
curl -s \
  -H "Authorization: Bearer ${MCP_AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -X POST http://localhost:3000/api/mcp/sse \
  -d '{"tool":"search_emails","args":{"query":"invoice"}}'
```

Supported tools:

- `search_emails` with `{ "query": "..." }`
- `get_email_context` with `{ "message_id": 123 }`
- `list_folders` with `{ "account_id": 1 }` (optional `account_id`)
- `move_message` with `{ "message_id": 123, "folder_path": "Archive" }`
- `set_read` with `{ "message_id": 123, "read": true }`
- `set_flagged` with `{ "message_id": 123, "flagged": true }`
- `generate_suggestion` with `{ "message_id": 123 }`
- `regenerate_suggestion` with `{ "message_id": 123, "note": "make it shorter" }`
- `execute_suggestion` with `{ "suggestion_id": 456 }`

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
- BYO tools run under instance-owner trust model; treat tool access as highly privileged

---

## 16) Troubleshooting

### `401` from DeepSeek during eval/runtime

Cause:

- invalid or expired key in the saved AI profile or the bootstrap env value

Actions:

1. Open Config -> AI Profiles and confirm the saved key for the active profile
2. If you are bootstrapping from `.env`, confirm the key there too
3. Re-run `npm run eval:ai`
4. Configure Gemini fallback so production suggestions continue

### Runtime uses a different DeepSeek key than `.env`

Cause:

- the app now prefers saved AI profiles from SQLite over bootstrap env defaults
- environment variables already exported in the shell can still override `.env` at process start
- long-running Node/dev processes keep env values loaded at startup

Actions:

1. Open Config -> AI Profiles and check which profile is enabled
2. Confirm the saved API key and base URL for that profile
3. If you changed `.env`, fully restart `npm run dev` / `node build` / container after edits
4. Avoid setting conflicting AI env vars in shell profiles when you expect the UI values to win

### Task planning uses model you did not expect

Cause:

- complexity routing may choose advanced planner profile

Actions:

1. Set `AI_ADVANCED_MODEL` explicitly
2. If you want one model only, set `AI_ADVANCED_MODEL` equal to `AI_MODEL`
3. Restart app/container after env changes

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
