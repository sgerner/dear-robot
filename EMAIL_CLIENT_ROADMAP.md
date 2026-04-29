# Email Client Roadmap

## Phase 1: Usable AI-First Client

Implemented in this codebase:

- Folder navigation with per-folder message counts and unread counts.
- Per-folder message filtering.
- Read/unread state changes.
- Star/unstar state changes.
- Move message between folders.
- Trash action as a folder move, not permanent deletion.
- Conversation timeline based on message/thread headers and normalized subject fallback.
- Compose, reply, reply all, and forward flows.
- To, cc, and bcc support for SMTP sends.
- Address book populated from observed and manually used contacts.
- Contact autocomplete through browser datalist.
- AI Action Card remains prominent above the message body.
- PWA manifest, icon, service worker, and installable standalone mode.
- Browser/PWA IndexedDB cache for recent messages, folders, contacts, and cache metadata.
- Expanded unit and E2E coverage for client actions.

Phase 1 intentionally does not include attach-to-send. Attachment metadata/display and safer download handling should land before outbound attachments.

## Phase 2: Attachments, Drafts, and Offline Polish

Implemented in this codebase:

- Attachment metadata persistence from MIME parsing.
- Attachment download routes secured by existing session/CSRF model.
- Attach-to-send in compose API and SMTP transport.
- Persistent server drafts with autosave.
- Offline outbox queue in browser cache with retry on reconnect.
- Rich/plain compose modes with HTML + plain-text fallback send body.

Remaining hardening items:

- Virus/malware scanning hook before attachment download/send.
- More complete OPFS SQLite cache if IndexedDB search becomes limiting.

## Phase 3: Sync Correctness and Provider Depth

Implemented in this codebase:

- UIDVALIDITY tracking state table (`folder_sync_state`) per account/folder.
- Incremental per-folder sync cursors using highest UID.
- Reconciliation pass for recent messages to pull remote read/answered/flagged changes.
- Provider-specific archive/spam/trash role mapping.
- Best-effort sent-mail append/upload for IMAP accounts after SMTP send.
- Bulk selection and bulk operations in UI + API.
- Contact CSV import/export routes and config-panel controls.

Remaining hardening items:

- Track and react to remote expunge/delete events in cache (current behavior prioritizes non-destructive local handling).
- Add per-folder sync throttling and concurrency caps for very large live mailboxes.

## Phase 4: AI-Native Mail Operations

Implemented in this codebase:

- Agent task/action-graph plans persisted as task runs and ordered task steps.
- Explicit approval and execution lifecycle for AI-planned steps.
- Bring-your-own tool gateway with UI-managed tool definitions (MCP HTTP and CLI).
- Tool call auditing with request/response capture and duration tracking.
- Complexity-based planning model routing (primary vs advanced profile).
- Advanced model support via `AI_ADVANCED_*` env configuration.

Remaining expansion items:

- AI-generated conversation-level summaries and daily briefings.
- Multiple draft variants with tone presets from the same task plan.
- Scheduled follow-up reminder automations.
- Richer delegation payload contracts and result callbacks.

## Phase 5: Production Hardening

- Attachment scanning policy.
- Admin audit views.
- Rate limiting and mailbox operation throttling.
- Encrypted browser cache option for shared devices.
- Backup/restore tooling for `/data`.
- Full live-provider integration suite gated by explicit environment flags.
