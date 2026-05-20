# AI Agent Supercharge Plan

Date: May 19, 2026

## Product Direction

Dear Robot should behave less like a one-shot email classifier and more like an inspectable email operations system. The agent should know the current message, the current thread, related messages outside the thread, durable user memory, known obligations, pending approvals, prior outcomes, and available tools before it recommends or executes anything.

The practical goal is an email client where users can trust the agent with preparation, retrieval, drafting, organizing, and follow-up tracking while retaining explicit control over irreversible or external actions.

## Recommendations

1. Use a unified context service for every AI surface.
   Suggestions, task planning, compose generation, daily briefings, and future automations should all pull from the same context assembler so behavior is consistent and auditable.

2. Treat obligations as first-class product data.
   Emails are full of commitments, deadlines, and "please follow up" language. Extracting obligations makes the agent useful even when no reply should be sent.

3. Build a daily briefing around action, not summaries.
   The briefing should answer: what needs attention, what is waiting on approval, what is due, what has risk, and what can be safely deferred.

4. Keep safety outside the prompt.
   Prompts should describe policy, but deterministic policy code should decide approval and risk boundaries for sends, deletes, tool calls, refunds, legal topics, contracts, medical/HR content, and low-confidence results.

5. Give the agent mailbox-native tools.
   `mailbox_search` should be treated as a built-in read-only tool. Future tools should include contact lookup, obligation lookup, thread timeline, folder policy lookup, and prior outcome lookup.

6. Capture every correction.
   Edited drafts, rejected suggestions, changed folders, dismissed obligations, and approved actions should become training signals through memory rules and quality metrics.

7. Add deterministic evals before expanding autonomy.
   The agent should have regression tests for risk classification, context retrieval, obligation extraction, draft behavior, folder selection, and approval requirements.

## Implemented In This Pass

### Unified Context

Added `src/lib/server/agent/context.ts`.

The context service assembles:

- Current message metadata and optional body
- Memory context
- Contact record for sender
- Thread summary
- Related emails outside the current thread
- Open follow-ups
- Open obligations
- Recent outcomes
- Recent tool calls
- Current thread snippets

This is now used by:

- AI suggestion generation through `relatedContext`
- Advanced task planning through `relatedEmailContext`, obligations, thread intelligence, and outcomes
- Compose generation for replies and contextual drafts
- `/api/agent/context/[id]`

### Related Email Retrieval

The prior `mailbox_search` work is now part of a broader context model. Suggestions and task plans can both see related emails by sender and subject/topic. The task runner can also execute explicit `mailbox_search` tool calls.

### Obligations

Added `agent_obligations` table with:

- `message_id`
- `account_id`
- `owner`
- `kind`
- `title`
- `evidence`
- `due_at`
- `status`
- `source`
- `confidence`

Added `src/lib/server/agent/obligations.ts`.

The extractor currently uses deterministic heuristics for phrases such as:

- "please reply/respond/review/send/share/confirm/schedule/follow up"
- "can you reply/respond/review/send/share/confirm/schedule/follow up"
- "need you to"
- "action required"
- "I will"
- "we will"
- "deadline"
- "due"
- "today"
- "tomorrow"
- "next week"
- "by Friday"
- ISO dates such as `2026-05-22`
- Relative dates such as "in two days" and "end of the month"

It runs during suggestion generation, task planning, and explicit briefing refresh. Normal page loads and GET reads do not trigger scans.

### Daily Briefing

Added `src/lib/server/agent/briefing.ts` and `/api/agent/briefing`.

The briefing includes:

- Pending approvals
- Due follow-ups
- Open obligations
- Important unread messages
- Thread intelligence
- Recommended focus

The Operations dashboard now shows briefing counts and top obligations.

The dashboard also includes an explicit refresh action so users can update briefing stats without a full page reload.

### Policy Engine

Added `src/lib/server/agent/policy.ts`.

The policy engine deterministically escalates risk and approval requirements for:

- External communication
- Write-capable tools
- Deletion
- Legal, contract, tax, medical, HR, password, bank, wire, chargeback topics
- Refunds, invoices, payments, deadlines, complaints, pricing
- Low-confidence actions

Task plan normalization now uses this policy layer.

High-risk content remains approval-gated even when the planned step is internally non-destructive, such as `draft_reply` or `mark_done`.

### Evals

Added `src/lib/server/agent/evals.ts` and `/api/agent/evals`.

Current evals cover:

- Refund replies require approval
- Low-risk archive candidates can stay low risk
- Legal work escalates to high risk

This is intentionally small but establishes a local pattern for agent quality checks.

Added `tests/agent-supercharge.test.ts` to the automated unit suite. It covers:

- Obligation extraction accuracy and common date inference
- Unified context aggregation for recent tool calls through `task_runs`
- Risk policy approval gating for sensitive draft and mark-done actions
- Briefing stats calculation without scan side effects on normal reads

## Review Fixes

- Replaced JSON-string `LIKE` lookup of tool calls with a relational join from `tool_calls` to `task_runs`.
- Removed redundant obligation extraction from autopilot after suggestion generation.
- Compact prompt context to cap related emails, obligations, outcomes, thread snippets, and long text fields before JSON serialization.
- Bounded obligation scans to at most 100 messages, with explicit briefing refresh scanning 50 messages.
- Removed scan side effects from GET endpoints for briefing and obligations.
- Added try/catch resilience around extraction and per-obligation persistence.
- Tightened obligation heuristics to reduce casual false positives.

## New APIs

- `GET /api/agent/briefing`
- `POST /api/agent/briefing`
- `GET /api/agent/context/[id]`
- `GET /api/agent/evals`
- `GET /api/agent/obligations`
- `POST /api/agent/obligations`

## Next Engineering Steps

1. Add UI controls to mark obligations done or dismissed directly from the briefing.
2. Add eval fixture mailboxes with expected obligation, folder, risk, and draft outputs.
3. Add context citations to visible suggestions and task plans.
4. Add a background job that refreshes obligations and thread intelligence after sync.
5. Add sender/project dossiers built from contact history, outcomes, and thread summaries.
6. Track correction-to-improvement metrics in the observability dashboard.

## Safety Boundary

The implementation keeps sends, forwards, delegation, destructive actions, and risky topics approval-gated. The new agent features increase context and preparation quality without granting silent irreversible authority.
