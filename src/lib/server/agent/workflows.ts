import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, nowIso } from '../db';
import {
  automationWorkflows,
  followUpReminders,
  messages,
  taskRuns
} from '../db/schema';
import { getMessageDetail } from '../services/messages';
import {
  AgentPlanSchema,
  type AgentPlan
} from './schema';
import {
  createTaskPlanForMessage,
  createTaskRunFromPlan,
  executeTaskRun
} from './tasks';
import { createAgentNotification, isWithinQuietHours, parseJson, recordAgentAudit } from './runtime';

const AutomationWorkflowBaseSchema = z.object({
  name: z.string().min(1).max(160),
  description: z.string().max(1200).nullable().optional(),
  enabled: z.boolean().default(false),
  trigger_type: z
    .enum(['manual', 'new_message', 'schedule', 'follow_up_due', 'webhook'])
    .default('manual'),
  schedule: z.string().max(120).nullable().optional(),
  timezone: z.string().max(80).default('UTC'),
  filters: z.record(z.string(), z.unknown()).default({}),
  plan_template: z.record(z.string(), z.unknown()).default({}),
  approval_mode: z.enum(['always', 'risk_based', 'read_only_auto']).default('always'),
  dry_run: z.boolean().default(true),
  max_runs_per_hour: z.coerce.number().int().min(1).max(1000).default(20),
  quiet_hours_start: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  quiet_hours_end: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional()
});

export const AutomationWorkflowSchema = AutomationWorkflowBaseSchema
  .superRefine((value, context) => {
    if (value.trigger_type === 'schedule' && !parseInterval(value.schedule || '')) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['schedule'],
        message: 'Schedule triggers require an interval such as “every 15m”.'
      });
    }
    if (value.schedule && !parseInterval(value.schedule)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['schedule'],
        message: 'Use an interval such as “every 15m”, “every 1h”, or “every 1d”.'
      });
    }
  });

export const AutomationWorkflowUpdateSchema = AutomationWorkflowBaseSchema.partial();

export function listAutomationWorkflows() {
  return db
    .select()
    .from(automationWorkflows)
    .orderBy(desc(automationWorkflows.updatedAt))
    .all()
    .map((workflow) => ({
      ...workflow,
      filters: parseJson(workflow.filtersJson, {}),
      planTemplate: parseJson(workflow.planTemplateJson, {})
    }));
}

export function getAutomationWorkflow(id: number) {
  const workflow = db.select().from(automationWorkflows).where(eq(automationWorkflows.id, id)).get();
  if (!workflow) return null;
  return {
    ...workflow,
    filters: parseJson(workflow.filtersJson, {}),
    planTemplate: parseJson(workflow.planTemplateJson, {})
  };
}

export function createAutomationWorkflow(input: unknown) {
  const parsed = AutomationWorkflowSchema.parse(input);
  assertPlanTemplate(parsed.plan_template);
  const now = nowIso();
  const nextRunAt = parsed.enabled ? nextWorkflowRunAt(parsed.trigger_type, parsed.schedule || null, now) : null;
  const created = db
    .insert(automationWorkflows)
    .values({
      name: parsed.name,
      description: parsed.description || null,
      enabled: parsed.enabled,
      triggerType: parsed.trigger_type,
      schedule: parsed.schedule || null,
      timezone: parsed.timezone,
      filtersJson: JSON.stringify(parsed.filters),
      planTemplateJson: JSON.stringify(parsed.plan_template),
      approvalMode: parsed.approval_mode,
      dryRun: parsed.dry_run,
      maxRunsPerHour: parsed.max_runs_per_hour,
      quietHoursStart: parsed.quiet_hours_start || null,
      quietHoursEnd: parsed.quiet_hours_end || null,
      nextRunAt,
      lastRunAt: null,
      createdAt: now,
      updatedAt: now
    })
    .returning()
    .get();
  recordAgentAudit({ workflowId: created.id, actor: 'user', eventType: 'workflow_created', payload: { name: created.name } });
  return getAutomationWorkflow(created.id);
}

export function updateAutomationWorkflow(id: number, input: unknown) {
  const parsed = AutomationWorkflowUpdateSchema.parse(input);
  const existing = db.select().from(automationWorkflows).where(eq(automationWorkflows.id, id)).get();
  if (!existing) return null;
  const now = nowIso();
  const enabled = parsed.enabled ?? existing.enabled;
  const schedule = parsed.schedule === undefined ? existing.schedule : parsed.schedule || null;
  const triggerType = parsed.trigger_type ?? existing.triggerType;
  if (parsed.plan_template !== undefined) assertPlanTemplate(parsed.plan_template);
  if (triggerType === 'schedule' && !parseInterval(schedule || '')) {
    throw new Error('Schedule triggers require an interval such as “every 15m”.');
  }
  if (schedule && !parseInterval(schedule)) {
    throw new Error('Use an interval such as “every 15m”, “every 1h”, or “every 1d”.');
  }
  const updated = db
    .update(automationWorkflows)
    .set({
      name: parsed.name ?? existing.name,
      description:
        parsed.description === undefined ? existing.description : parsed.description || null,
      enabled,
      triggerType,
      schedule,
      timezone: parsed.timezone ?? existing.timezone,
      filtersJson:
        parsed.filters === undefined ? existing.filtersJson : JSON.stringify(parsed.filters),
      planTemplateJson:
        parsed.plan_template === undefined
          ? existing.planTemplateJson
          : JSON.stringify(parsed.plan_template),
      approvalMode: parsed.approval_mode ?? existing.approvalMode,
      dryRun: parsed.dry_run ?? existing.dryRun,
      maxRunsPerHour: parsed.max_runs_per_hour ?? existing.maxRunsPerHour,
      quietHoursStart:
        parsed.quiet_hours_start === undefined
          ? existing.quietHoursStart
          : parsed.quiet_hours_start || null,
      quietHoursEnd:
        parsed.quiet_hours_end === undefined
          ? existing.quietHoursEnd
          : parsed.quiet_hours_end || null,
      nextRunAt: enabled
        ? nextWorkflowRunAt(triggerType, schedule, now)
        : null,
      updatedAt: now
    })
    .where(eq(automationWorkflows.id, id))
    .returning()
    .get();
  recordAgentAudit({ workflowId: id, actor: 'user', eventType: 'workflow_updated', payload: parsed });
  return getAutomationWorkflow(updated.id);
}

export function deleteAutomationWorkflow(id: number) {
  const existing = db.select().from(automationWorkflows).where(eq(automationWorkflows.id, id)).get();
  if (!existing) return false;
  db.delete(automationWorkflows).where(eq(automationWorkflows.id, id)).run();
  recordAgentAudit({ workflowId: id, actor: 'user', eventType: 'workflow_deleted', payload: { name: existing.name } });
  return true;
}

export async function runAutomationWorkflow(id: number, messageId?: number | null, actor = 'user') {
  const workflow = db.select().from(automationWorkflows).where(eq(automationWorkflows.id, id)).get();
  if (!workflow) throw new Error('Automation workflow not found');
  let candidates = await findCandidates(workflow, messageId ?? null);
  // A scheduled browser recipe is independent of whether a new email arrived.
  // Task runs still carry a message id for audit/context, so use the latest
  // mailbox message as an inspectable anchor when the schedule has no new mail.
  const templatePreview = parseJson(workflow.planTemplateJson, null);
  const browserSchedule =
    workflow.triggerType === 'schedule' &&
    templatePreview &&
    typeof templatePreview === 'object' &&
    Array.isArray((templatePreview as Record<string, unknown>).steps) &&
    ((templatePreview as Record<string, unknown>).steps as unknown[]).some(
      (step: unknown) =>
        step &&
        typeof step === 'object' &&
        ['browser_recipe', 'farin_upload'].includes(String((step as Record<string, unknown>).kind))
    );
  if (!candidates.length && browserSchedule) {
    candidates = db.select().from(messages).orderBy(desc(messages.updatedAt)).limit(1).all();
  }
  if (!candidates.length) {
    const now = nowIso();
    db.update(automationWorkflows)
      .set({
        lastRunAt: now,
        nextRunAt: nextWorkflowRunAt(workflow.triggerType, workflow.schedule, now),
        updatedAt: now
      })
      .where(eq(automationWorkflows.id, id))
      .run();
    return { workflowId: id, created: 0, runs: [] };
  }
  const recentCutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const recentCount =
    db
      .select({ count: sql<number>`count(*)` })
      .from(taskRuns)
      .where(and(eq(taskRuns.workflowId, id), gte(taskRuns.createdAt, recentCutoff)))
      .get()?.count ?? 0;
  const remaining = Math.max(0, workflow.maxRunsPerHour - recentCount);
  if (!remaining) {
    const now = nowIso();
    db.update(automationWorkflows)
      .set({
        lastRunAt: now,
        nextRunAt: nextWorkflowRunAt(workflow.triggerType, workflow.schedule, now),
        updatedAt: now
      })
      .where(eq(automationWorkflows.id, id))
      .run();
    recordAgentAudit({
      workflowId: id,
      actor,
      eventType: 'workflow_rate_limited',
      payload: { maxRunsPerHour: workflow.maxRunsPerHour }
    });
    return { workflowId: id, created: 0, runs: [], rateLimited: true };
  }
  const runs = [];
  for (const message of candidates.slice(0, remaining)) {
    if (!matchesFilters(message, parseJson(workflow.filtersJson, {}))) continue;
    const template = AgentPlanSchema.safeParse(parseJson(workflow.planTemplateJson, {}));
    const idempotencyKey = browserSchedule
      ? `workflow:${workflow.id}:schedule:${workflow.lastRunAt || nowIso()}`
      : `workflow:${workflow.id}:message:${message.id}:${message.updatedAt}`;
    const detail = getMessageDetail(message.id);
    const plan = template.success
      ? createTaskRunFromPlan(message.id, template.data as AgentPlan, {
          suggestionId: detail?.suggestion?.id ?? null,
          workflowId: workflow.id,
          triggerType: workflow.triggerType,
          actor,
          idempotencyKey,
          approvalMode: workflow.approvalMode,
          modelUsed: 'workflow-template',
          providerUsed: 'workflow'
        })
      : await createTaskPlanForMessage(message.id, {
          note: workflow.description || workflow.name,
          workflow_id: workflow.id,
          trigger_type: workflow.triggerType,
          actor,
          idempotency_key: idempotencyKey,
          approval_mode: workflow.approvalMode
        });
    runs.push(plan);
    recordAgentAudit({ workflowId: id, taskRunId: plan?.run?.id, actor, eventType: 'workflow_run_created', payload: { messageId: message.id } });
    if (!workflow.dryRun && plan?.run?.status === 'planned') {
      const executed = await executeTaskRun(plan.run.id);
      runs[runs.length - 1] = executed;
    }
  }
  const now = nowIso();
  db.update(automationWorkflows)
    .set({
      lastRunAt: now,
      nextRunAt: nextWorkflowRunAt(workflow.triggerType, workflow.schedule, now),
      updatedAt: now
    })
    .where(eq(automationWorkflows.id, id))
    .run();
  return { workflowId: id, created: runs.length, runs };
}

export async function runDueAutomationWorkflows() {
  const now = nowIso();
  notifyDueFollowUps();
  const retryableRuns = db
    .select({ id: taskRuns.id })
    .from(taskRuns)
    .where(and(eq(taskRuns.status, 'planned'), lte(taskRuns.nextRunAt, now)))
    .limit(20)
    .all();
  for (const row of retryableRuns) {
    try {
      await executeTaskRun(row.id);
    } catch (error) {
      recordAgentAudit({ taskRunId: row.id, actor: 'scheduler', eventType: 'task_retry_worker_failed', payload: { error: error instanceof Error ? error.message : String(error) } });
    }
  }
  const due = db
    .select()
    .from(automationWorkflows)
    .where(
      and(
        eq(automationWorkflows.enabled, true),
        inArray(automationWorkflows.triggerType, ['schedule', 'new_message', 'follow_up_due']),
        orDue(automationWorkflows.nextRunAt, now)
      )
    )
    .orderBy(asc(automationWorkflows.nextRunAt))
    .all();
  const results = [];
  for (const workflow of due) {
    if (isWithinQuietHours(new Date(), workflow.quietHoursStart, workflow.quietHoursEnd, workflow.timezone)) continue;
    const claimed = db
      .update(automationWorkflows)
      .set({ nextRunAt: new Date(Date.now() + 30000).toISOString(), updatedAt: nowIso() })
      .where(and(eq(automationWorkflows.id, workflow.id), orDue(automationWorkflows.nextRunAt, now)))
      .run();
    if (!claimed.changes) continue;
    try {
      results.push(await runAutomationWorkflow(workflow.id, null, 'scheduler'));
    } catch (error) {
      recordAgentAudit({ workflowId: workflow.id, actor: 'scheduler', eventType: 'workflow_run_failed', payload: { error: error instanceof Error ? error.message : String(error) } });
    }
  }
  return results;
}

function notifyDueFollowUps() {
  const due = db
    .select({ reminder: followUpReminders, message: messages })
    .from(followUpReminders)
    .innerJoin(messages, eq(messages.id, followUpReminders.messageId))
    .where(
      and(
        eq(followUpReminders.status, 'open'),
        lte(followUpReminders.dueAt, nowIso()),
        isNull(followUpReminders.notifiedAt)
      )
    )
    .limit(50)
    .all();
  const now = nowIso();
  for (const row of due) {
    createAgentNotification({
      type: 'follow_up',
      title: 'Follow-up due',
      body: `${row.message.subject}: ${row.reminder.reason}`
    });
    db.update(followUpReminders)
      .set({ notifiedAt: now, updatedAt: now })
      .where(eq(followUpReminders.id, row.reminder.id))
      .run();
  }
}

let schedulerStarted = false;
export function startWorkflowScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;
  void runDueAutomationWorkflows().catch((error) => console.warn('[dear-robot] workflow scheduler failed', error));
  const interval = setInterval(() => {
    void runDueAutomationWorkflows().catch((error) => console.warn('[dear-robot] workflow scheduler failed', error));
  }, 30000);
  interval.unref?.();
}

function orDue(column: typeof automationWorkflows.nextRunAt, now: string) {
  return sql`(${column} IS NULL OR datetime(${column}) <= datetime(${now}))`;
}

async function findCandidates(
  workflow: typeof automationWorkflows.$inferSelect,
  messageId: number | null
) {
  if (messageId) {
    const message = db.select().from(messages).where(eq(messages.id, messageId)).get();
    return message ? [message] : [];
  }
  if (workflow.triggerType === 'follow_up_due') {
    const rows = db
      .select({ message: messages })
      .from(followUpReminders)
      .innerJoin(messages, eq(messages.id, followUpReminders.messageId))
      .where(and(eq(followUpReminders.status, 'open'), lte(followUpReminders.dueAt, nowIso())))
      .limit(50)
      .all();
    return rows.map((row) => row.message);
  }
  const since = workflow.lastRunAt || new Date(Date.now() - 15 * 60 * 1000).toISOString();
  return db
    .select()
    .from(messages)
    .where(gte(messages.createdAt, since))
    .orderBy(desc(messages.createdAt))
    .limit(50)
    .all();
}

function matchesFilters(message: typeof messages.$inferSelect, raw: unknown) {
  const filters = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  if (typeof filters.accountId === 'number' && message.accountId !== filters.accountId) return false;
  if (typeof filters.folderPath === 'string' && message.folderPath !== filters.folderPath) return false;
  if (filters.unreadOnly === true && message.isRead) return false;
  if (typeof filters.senderContains === 'string' && !message.from.toLowerCase().includes(filters.senderContains.toLowerCase())) return false;
  if (typeof filters.subjectContains === 'string' && !message.subject.toLowerCase().includes(filters.subjectContains.toLowerCase())) return false;
  if (typeof filters.query === 'string') {
    const haystack = `${message.subject}\n${message.from}\n${message.bodyText}`.toLowerCase();
    if (!haystack.includes(filters.query.toLowerCase())) return false;
  }
  return true;
}

function nextScheduleAt(schedule: string | null, from: string) {
  if (!schedule) return null;
  const interval = parseInterval(schedule);
  if (!interval) return null;
  return new Date(new Date(from).getTime() + interval).toISOString();
}

function nextWorkflowRunAt(triggerType: string, schedule: string | null, from: string) {
  if (triggerType === 'manual' || triggerType === 'webhook') return null;
  return nextScheduleAt(schedule || 'every 1m', from);
}

function assertPlanTemplate(template: Record<string, unknown>) {
  if (!Object.keys(template).length) return;
  const parsed = AgentPlanSchema.safeParse(template);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`Invalid plan template${issue?.path.length ? ` at ${issue.path.join('.')}` : ''}: ${issue?.message || 'check the JSON schema'}`);
  }
}

function parseInterval(schedule: string) {
  const match = schedule.trim().match(/^every\s+(\d+)\s*(s|m|h|d)$/i);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const multiplier = unit === 's' ? 1000 : unit === 'm' ? 60000 : unit === 'h' ? 3600000 : 86400000;
  return Math.max(1000, amount * multiplier);
}
