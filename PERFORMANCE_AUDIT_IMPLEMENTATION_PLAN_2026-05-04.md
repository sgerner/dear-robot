# Dear Robot Performance Audit and Implementation Plan

Date: May 4, 2026

## Implementation status (May 5, 2026)

- Completed:
  - P0-1 core split: view-scoped load contracts and targeted invalidation keys.
  - P0-2: non-destructive FTS boot migration.
  - P0-4: index additions for hot query paths.
  - P1-2 core: avoided unconditional cache writes outside inbox view.
  - P1-3: removed task-detail N+1 on primary load.
  - P2-1 core: reduced repeated per-message DB reads in bulk actions.
- Partially completed:
  - P0-3: removed repeated sync backfill pass and batched existence checks; full lazy body/attachment hydration remains.
  - P1-4: load contract partitioned, but UI module-level code splitting remains.

## Scope and baseline

- Full app pass across server load path, SQLite query patterns, IMAP sync pipeline, and client runtime.
- Build baseline from `npm run build`:
  - Client page chunk: `_app/immutable/nodes/2.*.js` = **286.21 kB** (gzip **74.59 kB**).
  - SSR page entry: `entries/pages/_page.svelte.js` = **438.11 kB** (gzip **66.96 kB**).
- Query plan baseline (captured via `EXPLAIN QUERY PLAN` against `data/dear-robot.db`):
  - `listMessages` uses correlated subqueries and temp B-trees for latest suggestion lookup.
  - `pendingSuggestions` scans `ai_suggestions` and `agent_action_queue`.
  - Folder counts use per-folder correlated count subqueries.

## Highest-impact findings (priority ordered)

## P0-1: Break the monolithic page load contract

- Evidence:
  - `src/routes/+page.server.ts` loads inbox data, settings data, operations data, memory data, and audit data in one request regardless of view.
  - `src/routes/+page.server.ts:55-107`
  - `src/routes/+page.svelte` uses many `invalidateAll()` calls for actions that mutate only one domain.
- Expected impact:
  - Largest end-to-end latency reduction for all interactions.
  - Removes repeated heavy DB work and payload transfer on every action.
- Regression risk:
  - **Medium**. Risk of stale UI state if invalidation boundaries are wrong.
- Implementation plan:
  1. Split server load into view-specific loaders:
  - `inbox` data only: messages, selected message, folders.
  - `settings` data only: accounts, AI profiles, oauth settings, tools, memory profile.
  - `operations` data only: autopilot dashboard, executed actions, task runs.
  2. Move non-critical panels to dedicated endpoints and fetch on demand.
  3. Replace `invalidateAll()` with targeted invalidation keys (`depends`/`invalidate`) and local state patching for single-record actions.
  4. Keep URL-driven navigation, but avoid reloading unrelated data.
- Primary files:
  - `src/routes/+page.server.ts`
  - `src/routes/+page.svelte`
  - Add targeted endpoint loaders under `src/routes/api/...`

## P0-2: Stop rebuilding FTS index at boot

- Evidence:
  - Boot path drops triggers/table and rebuilds `messages_fts` every startup.
  - `src/lib/server/db/bootstrap.ts:439-466`
- Expected impact:
  - Faster startup/restart and lower boot-time I/O on larger mailboxes.
- Regression risk:
  - **Low** if migrated correctly.
- Implementation plan:
  1. Replace destructive boot logic with idempotent migration:
  - Create `messages_fts` only if missing.
  - Create triggers only if missing.
  - Backfill only when table is newly created or a one-time migration flag is absent.
  2. Add migration version key in DB metadata table.
  3. Keep fallback-to-LIKE behavior when FTS5 unavailable.
- Primary files:
  - `src/lib/server/db/bootstrap.ts`

## P0-3: Make IMAP sync incremental and metadata-first

- Evidence:
  - Each sync loop does incremental fetch then always another `backfill(..., 200)` per folder.
  - `src/lib/server/sync.ts:92-99`
  - IMAP fetch requests full `source` and parses every message body/attachments during sync.
  - `src/lib/server/email/imap.ts:80-87`, `133-140`, `210-217`
  - Attachment bodies are converted to base64 during ingest.
  - `src/lib/server/email/imap.ts:381-398`
- Expected impact:
  - Major CPU/memory/network reduction on active accounts and large folders.
  - Lower sync latency and less DB growth.
- Regression risk:
  - **High**. Touches sync correctness and message content consistency.
- Implementation plan:
  1. Introduce two-stage ingest:
  - Stage A: headers/envelope/flags only for list views and change detection.
  - Stage B: fetch full body/attachments lazily on message-open or attachment-open.
  2. Remove unconditional `recent backfill` per cycle; replace with bounded UID reconciliation window and periodic deep sync job.
  3. Persist attachment metadata only during sync; fetch binary content on demand.
  4. Add sync telemetry counters (messages scanned/fetched/parsed, bytes processed, sync duration).
- Primary files:
  - `src/lib/server/sync.ts`
  - `src/lib/server/email/imap.ts`
  - `src/lib/server/services/messages.ts`
  - `src/lib/server/db/schema.ts` (if adding “content fetched” flags)

## P0-4: Add missing indexes for live query patterns

- Evidence:
  - Frequent filters/sorts lack supporting indexes (`ai_suggestions.status`, `created_at`, queue status, follow-up status, etc.).
  - `src/lib/server/db/schema.ts` table defs show only a small index set.
  - Query plan shows scans on `ai_suggestions` and `agent_action_queue`.
- Expected impact:
  - Faster dashboards, suggestion lookups, and autopilot cycles as data grows.
- Regression risk:
  - **Low**. Writes become slightly slower; acceptable tradeoff.
- Implementation plan:
  1. Add indexes:
  - `ai_suggestions(message_id, created_at DESC)`
  - `ai_suggestions(status, created_at DESC)`
  - `executed_actions(message_id, created_at DESC)`
  - `agent_action_queue(status, created_at DESC)`
  - `agent_action_queue(suggestion_id)`
  - `follow_up_reminders(status, due_at)`
  - `ai_observability(created_at DESC)`
  - `task_runs(message_id, created_at DESC)`
  - `task_steps(task_run_id, step_index)`
  - `message_attachments(message_id)`
  2. Add matching `CREATE INDEX IF NOT EXISTS` statements in bootstrap migration.
  3. Validate with `EXPLAIN QUERY PLAN` snapshots before/after.
- Primary files:
  - `src/lib/server/db/schema.ts`
  - `src/lib/server/db/bootstrap.ts`

## P1 improvements

## P1-1: Remove correlated latest-suggestion subquery from `listMessages`

- Evidence:
  - Latest suggestion lookup is executed as correlated scalar subquery and repeated.
  - `src/lib/server/services/messages.ts:133-139`, `186-195`
- Expected impact:
  - Significant DB improvement when message count and suggestion history grow.
- Regression risk:
  - **Medium**. Must preserve “latest suggestion by createdAt” behavior.
- Implementation plan:
  1. Build a derived table/CTE for latest suggestion per message once.
  2. Join message list against that derived result.
  3. Keep same shape returned to UI.

## P1-2: Avoid full IndexedDB rewrites on each data refresh

- Evidence:
  - Every `data` change clears and rewrites `messages`, `folders`, and `contacts`.
  - `src/routes/+page.svelte:389-395`
  - `src/lib/client/local-cache.ts:109-122`
- Expected impact:
  - Lower main-thread work and less IndexedDB churn, especially with encrypted cache enabled.
- Regression risk:
  - **Low-Medium**. Cache drift if merge logic is wrong.
- Implementation plan:
  1. Replace `clear + put all` with keyed upsert and tombstone delete.
  2. Persist and compare a server `etag/version` before cache writes.
  3. Only update changed stores for the current view.

## P1-3: Remove N+1 task detail loading from main page

- Evidence:
  - Main load lists task runs, then fetches each detail individually.
  - `src/routes/+page.server.ts:70-73`
  - `src/lib/server/agent/tasks.ts:37-58`
- Expected impact:
  - Faster message-open path and fewer DB roundtrips.
- Regression risk:
  - **Low**.
- Implementation plan:
  1. Add `listTaskRunSummariesWithSteps(messageId, limit)` query.
  2. Load details only when task drawer is opened.

## P1-4: Break up `+page.svelte` into route-level chunks

- Evidence:
  - Single page component is 3208 lines and dominates bundle output.
  - `src/routes/+page.svelte`
- Expected impact:
  - Better initial load/hydration time and less JS parse/execute on inbox-only usage.
- Regression risk:
  - **Medium**. Requires careful state and prop decomposition.
- Implementation plan:
  1. Split into `InboxWorkspace`, `SettingsWorkspace`, `OperationsWorkspace`.
  2. Use dynamic imports for settings/operations panels.
  3. Keep shared state minimal and serializable.

## P2 improvements

## P2-1: Batch provider operations for bulk actions

- Evidence:
  - Bulk action loops perform per-message provider calls and repeated detail lookup.
  - `src/lib/server/services/messages.ts:488-498`, `503-527`
- Expected impact:
  - Better throughput for multi-message actions.
- Regression risk:
  - **Medium**. Provider capability differences.
- Implementation plan:
  1. Introduce provider batch interfaces (`moveMany`, `markReadMany`, `flagMany`) with fallback to sequential.
  2. Reuse one connection/lock per folder batch where provider allows.

## P2-2: Add periodic DB maintenance hooks

- Evidence:
  - Long-running mailbox systems need stats refresh and WAL management.
- Expected impact:
  - More stable query planner choices and disk behavior over time.
- Regression risk:
  - **Low**.
- Implementation plan:
  1. Schedule `ANALYZE` after large imports/backfills.
  2. Run passive WAL checkpoint on startup and periodic intervals.

## Execution roadmap

1. Week 1: P0-2 and P0-4 (boot/index migrations, low-risk, immediate wins).
2. Week 2: P0-1 (loader segmentation + targeted invalidation).
3. Week 3-4: P0-3 (IMAP incremental redesign behind feature flag).
4. Week 5: P1-1 and P1-3 (query simplification and task loading).
5. Week 6: P1-2 and P1-4 (cache delta writes and UI chunk split).
6. Week 7+: P2 items.

## Regression assessment and verification plan

- Performance guardrails:
  - Track p50/p95 for:
    - inbox load
    - select message
    - search
    - bulk action
    - sync cycle duration
  - Track DB file/WAL growth weekly.
- Correctness checks:
  - Run `npm run check` after TS/Svelte changes.
  - Run focused Playwright for inbox navigation, message actions, settings, and operations.
  - Run full `npm run test:e2e` before landing P0-1 and P0-3.
- Rollout safety:
  - Feature flag for IMAP metadata-first sync.
  - Keep fallback paths for FTS and non-batch provider operations.
