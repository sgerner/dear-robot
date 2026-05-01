import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, nowIso } from '../db';
import { env } from '../env';
import {
  agentActionQueue,
  aiObservability,
  aiSuggestions,
  automationPolicies,
  autopilotRuns,
  followUpReminders,
  messages,
  outcomeEvents,
  threadSummaries
} from '../db/schema';
import { executeSuggestion, getMessageDetail, suggestForMessage } from '../services/messages';
import { promptHash, recordAiObservation } from './observability';

export const AutopilotPolicySchema = z.object({
  autopilotEnabled: z.boolean().default(false),
  dryRunOnly: z.boolean().default(true),
  allowAutoFileLowRisk: z.boolean().default(false),
  allowAutoNoActionLowRisk: z.boolean().default(false),
  requireApprovalForSend: z.boolean().default(true),
  maxMessagesPerRun: z.coerce.number().int().min(1).max(200).default(25),
  maxAutoActionsPerRun: z.coerce.number().int().min(0).max(100).default(5),
  followUpDays: z.coerce.number().int().min(1).max(30).default(2),
  autoApproveReadOnlyToolCalls: z.boolean().default(true)
});

export const QueueBulkSchema = z.object({
  ids: z.array(z.coerce.number().int().positive()).min(1).max(200)
});

export const OutcomeSchema = z.object({
  messageId: z.coerce.number().int().positive(),
  suggestionId: z.coerce.number().int().positive().nullable().optional(),
  actionQueueId: z.coerce.number().int().positive().nullable().optional(),
  outcomeType: z.enum(['resolved', 'needs_followup', 'bad_draft', 'wrong_action', 'positive_reply', 'negative_reply']),
  notes: z.string().max(2000).nullable().optional()
});

type Policy = ReturnType<typeof getAutopilotPolicy>;
let schedulerStarted = false;
let autopilotInFlight = false;

export function getAutopilotPolicy() {
  const policy = db.select().from(automationPolicies).orderBy(automationPolicies.id).get();
  if (policy) return policy;
  const now = nowIso();
  return db
    .insert(automationPolicies)
    .values({
      name: 'default',
      alwaysRequireApproval: true,
      autoApproveReadOnlyToolCalls: true,
      autopilotEnabled: false,
      dryRunOnly: true,
      allowAutoFileLowRisk: false,
      allowAutoNoActionLowRisk: false,
      requireApprovalForSend: true,
      maxMessagesPerRun: 25,
      maxAutoActionsPerRun: 5,
      followUpDays: 2,
      createdAt: now,
      updatedAt: now
    })
    .returning()
    .get();
}

export function updateAutopilotPolicy(input: unknown) {
  const parsed = AutopilotPolicySchema.parse(input);
  const current = getAutopilotPolicy();
  return db
    .update(automationPolicies)
    .set({
      ...parsed,
      alwaysRequireApproval: true,
      updatedAt: nowIso()
    })
    .where(eq(automationPolicies.id, current.id))
    .returning()
    .get();
}

export function listAutopilotDashboard() {
  const queue = db
    .select({
      id: agentActionQueue.id,
      messageId: agentActionQueue.messageId,
      suggestionId: agentActionQueue.suggestionId,
      actionType: agentActionQueue.actionType,
      riskLevel: agentActionQueue.riskLevel,
      status: agentActionQueue.status,
      title: agentActionQueue.title,
      approvalReason: agentActionQueue.approvalReason,
      detailsJson: agentActionQueue.detailsJson,
      errorMessage: agentActionQueue.errorMessage,
      createdAt: agentActionQueue.createdAt,
      updatedAt: agentActionQueue.updatedAt,
      subject: messages.subject,
      sender: messages.from
    })
    .from(agentActionQueue)
    .innerJoin(messages, eq(messages.id, agentActionQueue.messageId))
    .where(inArray(agentActionQueue.status, ['proposed', 'approved', 'failed']))
    .orderBy(desc(agentActionQueue.createdAt))
    .limit(80)
    .all();
  const runs = db.select().from(autopilotRuns).orderBy(desc(autopilotRuns.startedAt)).limit(12).all();
  const summaries = db.select().from(threadSummaries).orderBy(desc(threadSummaries.updatedAt)).limit(12).all();
  const followUps = db
    .select({
      id: followUpReminders.id,
      messageId: followUpReminders.messageId,
      dueAt: followUpReminders.dueAt,
      reason: followUpReminders.reason,
      status: followUpReminders.status,
      subject: messages.subject,
      sender: messages.from
    })
    .from(followUpReminders)
    .innerJoin(messages, eq(messages.id, followUpReminders.messageId))
    .where(eq(followUpReminders.status, 'open'))
    .orderBy(followUpReminders.dueAt)
    .limit(30)
    .all();
  const observability = db.select().from(aiObservability).orderBy(desc(aiObservability.createdAt)).limit(20).all();
  const outcomes = db.select().from(outcomeEvents).orderBy(desc(outcomeEvents.createdAt)).limit(20).all();
  const stats = {
    proposed: countQueue('proposed'),
    approved: countQueue('approved'),
    failed: countQueue('failed'),
    openFollowUps: followUps.length,
    avgLatencyMs: Math.round(db.select({ value: sql<number>`coalesce(avg(latency_ms), 0)` }).from(aiObservability).get()?.value || 0)
  };
  return { policy: getAutopilotPolicy(), queue, runs, summaries, followUps, observability, outcomes, stats };
}

export async function runAutopilotNow() {
  const policy = getAutopilotPolicy();
  const startedAt = nowIso();
  const run = db
    .insert(autopilotRuns)
    .values({
      status: 'running',
      mode: policy.dryRunOnly ? 'dry_run' : 'assistive',
      scannedCount: 0,
      suggestedCount: 0,
      queuedCount: 0,
      executedCount: 0,
      errorMessage: null,
      summaryJson: '{}',
      startedAt
    })
    .returning()
    .get();
  let scannedCount = 0;
  let suggestedCount = 0;
  let queuedCount = 0;
  let executedCount = 0;
  const errors: string[] = [];
  try {
    const pendingSuggestions = db
      .select()
      .from(aiSuggestions)
      .where(sql`ai_suggestions.status = 'pending' AND NOT EXISTS (
        SELECT 1 FROM agent_action_queue q WHERE q.suggestion_id = ai_suggestions.id
      )`)
      .orderBy(desc(aiSuggestions.createdAt))
      .limit(policy.maxMessagesPerRun)
      .all();
    for (const suggestion of pendingSuggestions) {
      scannedCount += 1;
      const queued = enqueueSuggestion(suggestion.id, 'autopilot-existing');
      if (queued) queuedCount += 1;
      recordAiObservation({
        messageId: suggestion.messageId,
        suggestionId: suggestion.id,
        operation: 'adopt_existing_suggestion',
        provider: 'seeded',
        model: 'existing',
        status: 'ok',
        latencyMs: 0,
        promptHash: promptHash({ suggestionId: suggestion.id, source: 'existing' }),
        estimatedCostCents: 0
      });
      upsertThreadSummaryForMessage(suggestion.messageId);
      ensureFollowUpForMessage(suggestion.messageId, suggestion.id, policy);
    }
    const candidates = db
      .select()
      .from(messages)
      .where(sql`${latestSuggestionIdSql()} IS NULL`)
      .orderBy(desc(messages.date))
      .limit(Math.max(0, policy.maxMessagesPerRun - scannedCount))
      .all();
    for (const message of candidates) {
      scannedCount += 1;
      try {
        const suggestion = await suggestForMessage(message.id);
        suggestedCount += 1;
        const queued = enqueueSuggestion(suggestion.id, 'autopilot');
        if (queued) queuedCount += 1;
        if (queued && canAutoExecute(suggestion, policy) && executedCount < policy.maxAutoActionsPerRun) {
          await approveQueueItems([queued.id]);
          await executeQueueItems([queued.id]);
          executedCount += 1;
        }
        upsertThreadSummaryForMessage(message.id);
        ensureFollowUpForMessage(message.id, suggestion.id, policy);
      } catch (error) {
        errors.push(`${message.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const summary = { errors: errors.slice(0, 10) };
    db.update(autopilotRuns)
      .set({
        status: errors.length ? 'failed' : 'completed',
        scannedCount,
        suggestedCount,
        queuedCount,
        executedCount,
        errorMessage: errors[0] || null,
        summaryJson: JSON.stringify(summary),
        finishedAt: nowIso()
      })
      .where(eq(autopilotRuns.id, run.id))
      .run();
  } catch (error) {
    db.update(autopilotRuns)
      .set({
        status: 'failed',
        scannedCount,
        suggestedCount,
        queuedCount,
        executedCount,
        errorMessage: error instanceof Error ? error.message : String(error),
        finishedAt: nowIso()
      })
      .where(eq(autopilotRuns.id, run.id))
      .run();
  }
  return db.select().from(autopilotRuns).where(eq(autopilotRuns.id, run.id)).get();
}

export function startAutopilotScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;
  const intervalMs = Math.max(1, env.AUTOPILOT_INTERVAL_MINUTES) * 60 * 1000;
  setInterval(() => {
    const policy = getAutopilotPolicy();
    if (!policy.autopilotEnabled || autopilotInFlight) return;
    autopilotInFlight = true;
    runAutopilotNow()
      .catch((error) => console.warn('[triage] autopilot run failed', error instanceof Error ? error.message : error))
      .finally(() => {
        autopilotInFlight = false;
      });
  }, intervalMs).unref?.();
}

export function enqueueSuggestion(suggestionId: number, source = 'manual') {
  const suggestion = db.select().from(aiSuggestions).where(eq(aiSuggestions.id, suggestionId)).get();
  if (!suggestion) return null;
  const message = db.select().from(messages).where(eq(messages.id, suggestion.messageId)).get();
  if (!message) return null;
  const now = nowIso();
  const idempotencyKey = `suggestion:${suggestion.id}:${suggestion.recommendedAction}`;
  return db
    .insert(agentActionQueue)
    .values({
      messageId: message.id,
      suggestionId: suggestion.id,
      taskRunId: null,
      actionType: suggestion.recommendedAction,
      riskLevel: suggestion.riskLevel,
      status: 'proposed',
      title: titleForSuggestion(suggestion, message.subject),
      detailsJson: JSON.stringify({
        category: suggestion.category,
        confidence: suggestion.confidence,
        targetFolder: suggestion.targetFolder,
        draftReply: suggestion.draftReply,
        forwardTo: suggestion.forwardTo,
        delegateInstructions: suggestion.delegateInstructions,
        reasoningSummary: suggestion.reasoningSummary
      }),
      approvalReason: approvalReasonForSuggestion(suggestion),
      source,
      idempotencyKey,
      errorMessage: null,
      createdAt: now,
      updatedAt: now,
      executedAt: null
    })
    .onConflictDoNothing()
    .returning()
    .get();
}

export function approveQueueItems(ids: number[]) {
  if (!ids.length) return { updated: 0 };
  const now = nowIso();
  const result = db
    .update(agentActionQueue)
    .set({ status: 'approved', updatedAt: now })
    .where(and(inArray(agentActionQueue.id, ids), eq(agentActionQueue.status, 'proposed')))
    .run();
  return { updated: result.changes };
}

export function rejectQueueItems(ids: number[]) {
  if (!ids.length) return { updated: 0 };
  const now = nowIso();
  const result = db
    .update(agentActionQueue)
    .set({ status: 'rejected', updatedAt: now })
    .where(and(inArray(agentActionQueue.id, ids), inArray(agentActionQueue.status, ['proposed', 'approved', 'failed'])))
    .run();
  return { updated: result.changes };
}

export async function executeQueueItems(ids: number[]) {
  const rows = db
    .select()
    .from(agentActionQueue)
    .where(and(inArray(agentActionQueue.id, ids), inArray(agentActionQueue.status, ['approved', 'failed'])))
    .all();
  let executed = 0;
  for (const row of rows) {
    const now = nowIso();
    db.update(agentActionQueue).set({ status: 'executing', updatedAt: now, errorMessage: null }).where(eq(agentActionQueue.id, row.id)).run();
    try {
      if (!row.suggestionId) throw new Error('Queue item has no suggestion');
      const result = await executeSuggestion(row.suggestionId);
      db.update(agentActionQueue)
        .set({ status: 'executed', executedAt: nowIso(), updatedAt: nowIso(), errorMessage: null })
        .where(eq(agentActionQueue.id, row.id))
        .run();
      executed += result ? 1 : 0;
    } catch (error) {
      db.update(agentActionQueue)
        .set({
          status: 'failed',
          errorMessage: error instanceof Error ? error.message : String(error),
          updatedAt: nowIso()
        })
        .where(eq(agentActionQueue.id, row.id))
        .run();
    }
  }
  return { executed, requested: ids.length };
}

export function recordOutcome(input: unknown) {
  const parsed = OutcomeSchema.parse(input);
  const inserted = db
    .insert(outcomeEvents)
    .values({
      messageId: parsed.messageId,
      suggestionId: parsed.suggestionId ?? null,
      actionQueueId: parsed.actionQueueId ?? null,
      outcomeType: parsed.outcomeType,
      notes: parsed.notes ?? null,
      createdAt: nowIso()
    })
    .returning()
    .get();
  if (parsed.outcomeType === 'resolved' && parsed.messageId) {
    db.update(followUpReminders).set({ status: 'done', updatedAt: nowIso() }).where(eq(followUpReminders.messageId, parsed.messageId)).run();
  }
  return inserted;
}

export function upsertThreadSummaryForMessage(messageId: number) {
  const detail = getMessageDetail(messageId);
  if (!detail?.message) return null;
  const thread = detail.thread || [detail.message];
  const threadKey = detail.message.threadId || normalizeSubject(detail.message.subject);
  const openQuestions = extractQuestions(thread.map((item) => item.bodyText).join('\n'));
  const commitments = extractCommitments(thread.map((item) => item.bodyText).join('\n'));
  const latest = thread[thread.length - 1] || detail.message;
  const summary = summarizeThread(thread);
  const urgency = inferUrgency(`${latest.subject}\n${latest.bodyText}`);
  const now = nowIso();
  return db
    .insert(threadSummaries)
    .values({
      accountId: detail.message.accountId,
      threadKey,
      subject: normalizeDisplaySubject(detail.message.subject),
      summary,
      openQuestions: JSON.stringify(openQuestions),
      commitments: JSON.stringify(commitments),
      nextAction: nextActionFor(latest.bodyText, urgency),
      urgency,
      createdAt: now,
      updatedAt: now
    })
    .onConflictDoUpdate({
      target: [threadSummaries.accountId, threadSummaries.threadKey],
      set: {
        subject: normalizeDisplaySubject(detail.message.subject),
        summary,
        openQuestions: JSON.stringify(openQuestions),
        commitments: JSON.stringify(commitments),
        nextAction: nextActionFor(latest.bodyText, urgency),
        urgency,
        updatedAt: now
      }
    })
    .returning()
    .get();
}

function ensureFollowUpForMessage(messageId: number, suggestionId: number, policy: Policy) {
  const suggestion = db.select().from(aiSuggestions).where(eq(aiSuggestions.id, suggestionId)).get();
  if (!suggestion || !['reply', 'delegate'].includes(suggestion.recommendedAction)) return null;
  const existing = db
    .select()
    .from(followUpReminders)
    .where(and(eq(followUpReminders.messageId, messageId), eq(followUpReminders.status, 'open')))
    .get();
  if (existing) return existing;
  const now = nowIso();
  const due = new Date(Date.now() + policy.followUpDays * 24 * 60 * 60 * 1000).toISOString();
  return db
    .insert(followUpReminders)
    .values({
      messageId,
      dueAt: due,
      reason: `AI proposed ${suggestion.recommendedAction}; verify the thread is resolved.`,
      status: 'open',
      createdAt: now,
      updatedAt: now
    })
    .returning()
    .get();
}

function canAutoExecute(suggestion: typeof aiSuggestions.$inferSelect, policy: Policy) {
  if (policy.dryRunOnly) return false;
  if (suggestion.riskLevel !== 'low') return false;
  if (['reply', 'forward', 'delegate'].includes(suggestion.recommendedAction) && policy.requireApprovalForSend) return false;
  if (['move_to_folder', 'archive', 'spam'].includes(suggestion.recommendedAction)) return policy.allowAutoFileLowRisk;
  if (suggestion.recommendedAction === 'no_action') return policy.allowAutoNoActionLowRisk;
  return false;
}

function countQueue(status: typeof agentActionQueue.$inferSelect.status) {
  return db.select({ count: sql<number>`count(*)` }).from(agentActionQueue).where(eq(agentActionQueue.status, status)).get()?.count || 0;
}

function latestSuggestionIdSql() {
  return sql<number>`(SELECT id FROM ai_suggestions s WHERE s.message_id = messages.id ORDER BY datetime(s.created_at) DESC LIMIT 1)`;
}

function titleForSuggestion(suggestion: typeof aiSuggestions.$inferSelect, subject: string) {
  const action = suggestion.recommendedAction.replaceAll('_', ' ');
  return `${action}: ${subject}`;
}

function approvalReasonForSuggestion(suggestion: typeof aiSuggestions.$inferSelect) {
  if (['reply', 'forward', 'delegate'].includes(suggestion.recommendedAction)) return 'Human approval required before external communication or tool delegation.';
  if (suggestion.riskLevel !== 'low') return `${suggestion.riskLevel} risk requires review.`;
  return suggestion.reasoningSummary;
}

function normalizeSubject(subject: string) {
  return subject.toLowerCase().replace(/^(re|fwd?):\s*/i, '').trim();
}

function normalizeDisplaySubject(subject: string) {
  return subject.replace(/^(re|fwd?):\s*/i, '').trim() || '(no subject)';
}

function summarizeThread(thread: Array<{ from: string; bodyText: string; date: string }>) {
  const first = thread[0];
  const last = thread[thread.length - 1];
  if (!first || !last) return 'No thread context available.';
  return `${thread.length} message(s). Latest from ${last.from}: ${last.bodyText.slice(0, 240).replace(/\s+/g, ' ')}`;
}

function extractQuestions(text: string) {
  return text
    .split(/(?<=[?])\s+/)
    .filter((part) => part.includes('?'))
    .map((part) => part.trim().slice(0, 180))
    .slice(0, 5);
}

function extractCommitments(text: string) {
  const lines = text.split(/\r?\n/).filter((line) => /\b(will|by|tomorrow|today|next week|follow up)\b/i.test(line));
  return lines.map((line) => line.trim().slice(0, 180)).slice(0, 5);
}

function inferUrgency(text: string): 'low' | 'medium' | 'high' {
  const lower = text.toLowerCase();
  if (/(urgent|asap|angry|chargeback|legal|today|immediately)/.test(lower)) return 'high';
  if (/(tomorrow|soon|refund|pricing|quote|deadline)/.test(lower)) return 'medium';
  return 'low';
}

function nextActionFor(text: string, urgency: 'low' | 'medium' | 'high') {
  if (/\?/.test(text)) return 'Answer the open question.';
  if (urgency === 'high') return 'Review and respond today.';
  if (/(quote|pricing|order|wholesale)/i.test(text)) return 'Prepare an operational reply with next steps.';
  return 'No immediate thread-level action detected.';
}
