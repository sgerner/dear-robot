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

## Remaining

- None for the requested v1 acceptance pass.

## Known Limitations

- The local `.env` DeepSeek API key currently returns HTTP 401, so `npm run eval:ai` validates structured AI-error fallback outputs instead of real model classifications unless valid provider credentials are supplied.

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

## Current Test Status

- `npm run check`: pass, 0 warnings.
- `npm run lint`: pass.
- `npm run test:unit`: pass, 1 test.
- `npm run test:e2e`: pass, 2 tests.
- `npm run eval:ai`: pass schema validation and summary output; DeepSeek returned 401 for the configured key, so safe AI-error suggestions were produced.
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
