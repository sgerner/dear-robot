# Implementation Status

## Completed

- SvelteKit app scaffolded with adapter-node, TypeScript, Tailwind, Playwright, Vitest, Drizzle, SQLite.
- SQLite schema/bootstrap for accounts, folders, messages, AI suggestions, feedback, webhooks, and executed actions.
- `/data/AGENT_INSTRUCTIONS.md` memory file with editor and safe default.
- Password-gated local session, same-site cookies, CSRF header checks, encrypted stored mail passwords.
- Mock email provider and IMAP/SMTP provider boundaries.
- DeepSeek primary and Gemini OpenAI-compatible fallback AI layer with Zod validation and one repair attempt.
- Main inbox UI, AI Action Card, accounts config, memory editor, executed actions view.
- API routes for messages, suggestions, accounts, memory, webhooks, health, MCP.
- Fixtures, eval harness, unit test, Playwright E2E tests.
- Dockerfile and docker-compose.
- Long-lived IMAP IDLE inbox watch loop per enabled account (with reconnect/backoff and singleton worker protection).
- FTS5 message search with trigger-maintained index and LIKE fallback for constrained SQLite environments.
- Safe HTML email rendering mode (server-side sanitization) plus text fallback.
- UX improvements: account-level inbox filter and keyboard shortcuts (`/`, `j`, `k`).
- Svelte check warnings removed (clean `npm run check`).
- Phase 1 email-client expansion: folder navigation/counts, per-folder filtering, move, star/unstar, read/unread, compose, reply, reply all, forward, cc/bcc, conversation view, contacts/autocomplete.
- PWA installability: manifest, icon, service worker, standalone mode metadata.
- Browser/PWA local cache: IndexedDB cache for recent messages, folders, contacts, and cache metadata.
- Future roadmap documented in `EMAIL_CLIENT_ROADMAP.md`.
- Phase 2 implemented: attachment metadata storage + authenticated download endpoints, attach-to-send, server drafts with autosave, offline outbox queue retry, and rich/plain compose with HTML fallback.
- Phase 3 implemented: folder UID cursor state (`folder_sync_state`), incremental sync fetch + recent reconciliation pass, provider role mapping for archive/spam/trash, IMAP sent-folder append after SMTP send, bulk message operations, and contacts CSV import/export.
- Phase 4 implemented: AI action-graph task planning, task approval/execution lifecycle, bring-your-own tool gateway (`mcp_http` + `cli`) with UI management, tool call audit logging, and advanced model routing for complex plans.
- AI provider profiles are now UI-managed with saved presets for DeepSeek, Gemini, OpenAI, Anthropic, Vertex, OpenRouter, and manual configuration.
- Onboarding banners now steer users through AI setup first, then real mailbox setup, and the seeded demo mailbox is pruned automatically when the first real account is added.
- Full memory system implemented: core profile store, learned rules/examples/events tables, retrieval-injected prompt context, automatic learning from suggestion edits/regenerations, and a Memory UI with Advanced mode gating for raw `AGENT_INSTRUCTIONS.md`.
- Audio dictation implemented for focused text inputs/textareas via browser recording + server transcription endpoint (`/api/audio/transcribe`) backed by a UI-managed `audio` AI profile.
- Google OAuth Gmail connect flow implemented with UI-managed client credentials (`/api/oauth/google/settings`) and OAuth start/callback routes that create/update Gmail accounts using token auth for IMAP/SMTP.
- AI-first Autopilot implemented: explicit scan loop, optional singleton background interval, unified action queue, policy controls, thread summaries, follow-up reminders, outcome learning, and AI observability.
- `AI_AGENT_IMPLEMENTATION_PLAN.md` added with the simplified architecture and next-step guidance.
- Mobile inbox swipe gestures implemented with browser-local customization for short/long left/right actions.
- Message quick action bars are browser-customizable, use Archive instead of Star by default, and overflow on mobile behind a three-dot menu.
- Folder role mapping is exposed in Settings -> Interface and persists to SQLite for archive/spam/trash/sent/drafts resolution.
- Root `AGENTS.md` added with repo engineering and UI conventions.

## Remaining

- Optional Phase 4 expansion: conversation summaries, multi-variant drafts, follow-up scheduling automations, and richer delegation callbacks.
- Optional AI UX expansion: per-profile test button, richer provider-specific hints, and model comparison previews.
- Optional sync hardening: remote expunge propagation and tighter sync throttling for very large mailboxes.

## Known Limitations

- Attachment security hardening (malware scanning and policy enforcement) is not yet implemented.
- IMAP sent-folder append is best-effort; when providers reject append, send still succeeds and message will appear once provider-side sent sync catches up.

## Commands Run

- `npm install` (escalated after sandbox DNS failures)
- `npm run check`
- `npm run lint`
- `npm run test:unit`
- `npm run test:e2e` (escalated for local server binding)
- `npm run eval:ai` (escalated for `tsx` IPC socket)
- `npm run build`
- `docker build -t triage .`
- Re-run pass after UX/search fixes: `npm run check`, `npm run lint`, `npm run test:unit`, `npm run test:e2e`, `npm run eval:ai`, `npm run build`, `docker build -t triage .`
- Phase 1 pass: `npm run check`, `npm run lint`, `npm run test:unit`, `npm run test:e2e`, `npm run eval:ai`, `npm run build`, `docker build -t triage .`
- Live credential smoke check: IMAP connect/list succeeded with 8 folders; SMTP `verify()` succeeded. No live messages were sent and no mailbox state was changed.
- Phase 2 pass: `npm run check`, `npm run lint`, `npm run test:unit`, `npm run test:e2e`, `npm run eval:ai`, `npm run build`
- Phase 3 pass: `npm run check`, `npm run lint`, `npm run test:unit`, `npm run test:e2e`, `npm run eval:ai`, `npm run build`, `docker build -t triage .`
- Phase 4 pass: `npm run check`, `npm run lint`, `npm run test:unit`, `npm run test:e2e`, `npm run eval:ai`, `npm run build`, `docker build -t triage .`
- Feature pass (audio + gmail oauth): `npm run check`, `npm run test:unit`, `npm run test:e2e`
- AI Autopilot pass: `npm run check`, `npm run test:unit`, `npm run test:e2e`, `npm run eval:ai`, `npm run lint`, `npm run build`, `docker build -t triage .`
- Interface/swipe pass: `npm run check`, `npm run test:unit`, `npm run test:e2e`, `npm run build`

## Current Test Status

- `npm run check`: pass, 0 warnings.
- `npm run lint`: pass.
- `npm run test:unit`: pass, 9 tests.
- `npm run test:e2e`: pass, 7 tests.
- `npm run eval:ai`: pass with real DeepSeek credentials and structured outputs for all fixtures.
- `npm run build`: pass.
- `docker build -t triage .`: pass.

## Recovery Instructions

If interrupted:

1. Read `package.json`.
2. Inspect `README.md`.
3. Inspect this file.
4. Inspect `tests/`.
5. Run `npm run check`.
6. Fix the first compiler/runtime error.
7. Continue with `npm run test:unit`, `npm run test:e2e`, `npm run eval:ai`, `npm run build`, and `docker build -t triage .`.
