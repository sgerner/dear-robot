# AI-First Email Agent Plan

## Design Principle

Keep the agent dumb and inspectable:

- SQLite tables, not a distributed workflow engine.
- Suggested actions, not hidden autonomy.
- One approval queue, not scattered buttons.
- Deterministic policy checks before execution.
- Audit rows for every AI call and every action.

The AI can feel powerful because it sees the mailbox, remembers behavior, proposes good next steps, and batches work. The architecture should remain boring enough to debug with SQL.

## Implemented Phases

### Phase 1: Autopilot Scan Loop

- Run an explicit autopilot pass from the UI.
- Run a singleton background pass when `autopilotEnabled` is true.
- Scan recent messages without suggestions.
- Generate AI suggestions.
- Queue proposed actions.
- Build thread summaries and follow-up reminders.
- Record AI observability rows.

### Phase 2: Unified Approval Queue

- Store proposed actions in `agent_action_queue`.
- Approve, reject, and execute queue items in bulk.
- Keep sends/forwards/delegations review-gated.
- Execute queue items through the existing suggestion executor.

### Phase 3: Policy and Simulation

- Policy lives in `automation_policies`.
- `dryRunOnly` is the default.
- Low-risk filing can be enabled separately.
- Low-risk no-action handling can be enabled separately.
- Sending, forwarding, and delegation remain approval-required by default.

### Phase 4: Conversation Intelligence

- Store compact thread summaries in `thread_summaries`.
- Extract open questions, commitments, urgency, and next action with deterministic heuristics.
- Use the summary panel as an operational view, not as hidden prompt state.

### Phase 5: Outcome Learning and Observability

- Record outcomes in `outcome_events`.
- Mark follow-ups resolved when the user records a resolved outcome.
- Store AI call metadata in `ai_observability`: provider, model, operation, latency, prompt hash, status, rough cost.

## What Stayed Intentionally Simple

- The scheduler is just one in-process interval calling the same service as the UI.
- No hidden auto-send. Queue execution still flows through existing guarded action execution.
- No vector database. Thread summaries and memory rules remain relational rows.
- No separate agent runtime. The SvelteKit monolith owns the loop.

## Next Useful Additions

- Richer outcome mining from later thread replies.
- Per-sender or per-domain policy overrides.
- Push/PWA notifications for blocked high-risk actions.
- Cost budget caps using the existing observability table.
