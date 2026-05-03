@/home/steven/.codex/RTK.md

# Repo Conventions

## Product Direction

Dear Robot is an AI-first email client. Keep the mechanics simple and inspectable: SvelteKit, SQLite, Drizzle, server-side secrets, and boring relational data. The UX should feel fast and agentic without hiding irreversible work from the user.

## Engineering

- Use `rtk` before shell commands in this repo.
- Prefer SvelteKit server routes plus shared `src/lib/server` services over new services or queues.
- Keep secrets server-only. Never expose API keys, OAuth secrets, SMTP passwords, or IMAP passwords to browser data.
- Prefer SQLite-backed settings for behavior that affects server actions. Browser-local preferences are acceptable for purely personal UI layout, keyboard, swipe, and PWA ergonomics.
- Validate mutation inputs with Zod.
- Do not auto-send, auto-delete, or execute destructive actions without an explicit user or approved agent action.
- Keep provider-specific AI, IMAP, SMTP, Gmail OAuth, and tool code isolated behind existing abstraction layers.

## UI Conventions

- Dark mode is the primary design target.
- Use a restrained monochrome base with one accent color.
- Do not add visible checkboxes. Use switch toggles for binary settings.
- Use icon buttons for compact actions and labels only where space allows.
- Add subtle Svelte/Tailwind transitions for elements that appear, disappear, move, or change state.
- Prefer `in:fade`, `in:fly`, `out:fade`, `animate:flip`, `transition-colors`, `transition-all`, and small scale/translate changes.
- On mobile, keep primary controls to one row and move overflow behind a `MoreVertical` menu.
- Avoid nested cards. Use cards only for repeated items, settings panels, modals, and framed tools.
- Every textarea or AI helper input should have the shared dictation control when practical.

## Email Client Behavior

- Folder actions should use folder roles first (`archive`, `spam`, `trash`, `sent`, `drafts`) and path fallbacks second.
- IMAP special-use folders are discovered during sync and stored in `folders.role`; users can override mappings in Settings -> Interface.
- Delete means move to Trash, never permanent deletion.
- Spam means move to spam/junk/spam-review mapping.
- Archive means move to archive/all-mail mapping when available.
- Draft composition is stored locally in the app DB; SMTP sends are appended to the provider Sent folder when supported.

## Testing

- Run `npm run check` after Svelte or TypeScript changes.
- Run focused Playwright tests for UI changes and full `npm run test:e2e` before declaring interaction work complete when feasible.
- Keep tests deterministic with the mock mailbox unless the user explicitly requests live-account testing.
