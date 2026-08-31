import { and, desc, eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { generateStructuredObject } from '../ai/provider';
import { type EmailSuggestion } from '../ai/schema';
import { db, nowIso } from '../db';
import {
  agentObligations,
  aiSuggestions,
  automationWorkflows,
  automationPolicies,
  followUpReminders,
  messages,
  taskRuns,
  taskSteps,
  toolCalls
} from '../db/schema';
import { readAgentInstructions } from '../memory';
import {
  getMessageDetail,
  listFoldersWithCounts,
  moveMessage,
  searchRelatedEmailsForAgent,
  sendComposedMessage,
  upsertDraft,
  dispatchDelegateForAgent
} from '../services/messages';
import { buildUnifiedAgentContext } from './context';
import { extractAndStoreObligationsForMessage } from './obligations';
import { assessAgentAction } from './policy';
import { buildAgentPlanMessages } from './prompts';
import {
  AgentPlanSchema,
  TaskApproveSchema,
  TaskEditSchema,
  TaskPlanInputSchema,
  TaskRunControlSchema,
  type AgentPlan
} from './schema';
import {
  executeTool,
  getAvailableAgentToolByName,
  listAvailableAgentTools
} from './tools';
import {
  createAgentNotification,
  evaluateCondition,
  parseJson,
  recordAgentAudit,
  resolveTemplates,
  type WorkflowContext
} from './runtime';
import { listBrowserRecipes, runBrowserRecipe } from '../browser';
import { uploadFarinFile } from '../farin';

const BUILTIN_MAILBOX_SEARCH_TOOL = {
  name: 'mailbox_search',
  description:
    'Search related emails outside the current thread using query, sender, and subject filters.',
  kind: 'builtin',
  readOnly: true,
  skillsMarkdown:
    'Use when the task needs cross-thread context, prior commitments, related incidents, or historical outcomes.'
} as const;

export function listTaskRuns(messageId?: number, limit = 50) {
  return db
    .select({
      id: taskRuns.id,
      messageId: taskRuns.messageId,
      status: taskRuns.status,
      workflowId: taskRuns.workflowId,
      triggerType: taskRuns.triggerType,
      idempotencyKey: taskRuns.idempotencyKey,
      complexity: taskRuns.complexity,
      modelUsed: taskRuns.modelUsed,
      providerUsed: taskRuns.providerUsed,
      summary: taskRuns.summary,
      resultSummary: taskRuns.resultSummary,
      errorMessage: taskRuns.errorMessage,
      attemptCount: taskRuns.attemptCount,
      maxAttempts: taskRuns.maxAttempts,
      currentStepIndex: taskRuns.currentStepIndex,
      nextRunAt: taskRuns.nextRunAt,
      cancelRequested: taskRuns.cancelRequested,
      actor: taskRuns.actor,
      startedAt: taskRuns.startedAt,
      finishedAt: taskRuns.finishedAt,
      createdAt: taskRuns.createdAt,
      updatedAt: taskRuns.updatedAt,
      subject: messages.subject
    })
    .from(taskRuns)
    .innerJoin(messages, eq(messages.id, taskRuns.messageId))
    .where(messageId ? eq(taskRuns.messageId, messageId) : undefined)
    .orderBy(desc(taskRuns.createdAt))
    .limit(limit)
    .all();
}

export function getTaskRunDetail(id: number) {
  const run = db.select().from(taskRuns).where(eq(taskRuns.id, id)).get();
  if (!run) return null;
  const steps = db
    .select()
    .from(taskSteps)
    .where(eq(taskSteps.taskRunId, id))
    .orderBy(taskSteps.stepIndex)
    .all();
  const message = db.select().from(messages).where(eq(messages.id, run.messageId)).get();
  return {
    run: {
      ...run,
      plan: safeParseJson(run.planJson)
    },
    message,
    steps: steps.map((step) => ({
      ...step,
      toolInput: safeParseJson(step.toolInputJson),
      output: safeParseJson(step.outputJson)
    }))
  };
}

export function listTaskRunDetailsForMessage(messageId: number, limit = 5) {
  const runs = db
    .select()
    .from(taskRuns)
    .where(eq(taskRuns.messageId, messageId))
    .orderBy(desc(taskRuns.createdAt))
    .limit(limit)
    .all();
  if (!runs.length) return [];
  const runIds = runs.map((run) => run.id);
  const steps = db
    .select()
    .from(taskSteps)
    .where(inArray(taskSteps.taskRunId, runIds))
    .orderBy(taskSteps.taskRunId, taskSteps.stepIndex)
    .all();
  const stepsByRunId = new Map<number, typeof steps>();
  for (const step of steps) {
    const existing = stepsByRunId.get(step.taskRunId) || [];
    existing.push(step);
    stepsByRunId.set(step.taskRunId, existing);
  }
  const message = db.select().from(messages).where(eq(messages.id, messageId)).get();
  return runs.map((run) => ({
    run: {
      ...run,
      plan: safeParseJson(run.planJson)
    },
    message,
    steps: (stepsByRunId.get(run.id) || []).map((step) => ({
      ...step,
      toolInput: safeParseJson(step.toolInputJson),
      output: safeParseJson(step.outputJson)
    }))
  }));
}

export async function createTaskPlanForMessage(messageId: number, input: unknown = {}) {
  const parsed = TaskPlanInputSchema.parse(input);
  const detail = getMessageDetail(messageId);
  if (!detail?.message) throw new Error('Message not found');
  const suggestion = detail.suggestion ? suggestionToShape(detail.suggestion) : null;
  const accountFolders = listFoldersWithCounts(detail.message.accountId).map(
    (folder) => folder.path
  );
  const tools = listAvailableAgentTools().filter((tool) => tool.isEnabled);
  const browserTools = listBrowserRecipes()
    .filter((recipe) => recipe.enabled)
    .map((recipe) => ({
      name: `browser_recipe:${recipe.id}`,
      description: `${recipe.description || recipe.name} (downloads a report from ${recipe.startUrl})`,
      kind: 'browser_recipe',
      readOnly: false,
      skillsMarkdown:
        'Replays only the saved allowlisted actions. Password fields are never replayed; the user must log in once while recording.'
    }));
  const farinTool = {
    name: 'farin_upload',
    description: 'Upload a browser-downloaded report to the configured Farin company after explicit review.',
    kind: 'farin_upload',
    readOnly: false,
    skillsMarkdown:
      'Requires an approved browser download path. This is always a high-risk external write.'
  };
  const unifiedContext = buildUnifiedAgentContext(messageId, {
    note: parsed.note || null,
    includeBody: false,
    relatedLimit: 10
  });
  const complexity = classifyComplexity(
    detail.message.subject,
    detail.message.bodyText,
    parsed.note || null
  );
  const messagesPrompt = buildAgentPlanMessages({
    agentInstructions: readAgentInstructions(),
    memoryContext: unifiedContext?.memoryContext || '',
    subject: detail.message.subject,
    sender: detail.message.from,
    recipients: detail.message.to,
    cc: detail.message.cc || null,
    date: detail.message.date,
    bodyText: detail.message.bodyText,
    availableFolders: accountFolders,
    existingSuggestion: suggestion,
    note: parsed.note || null,
    relatedEmailContext: unifiedContext?.relatedEmails || [],
    obligations: unifiedContext?.openObligations || [],
    recentOutcomes: unifiedContext?.recentOutcomes || [],
    threadSummary: unifiedContext?.threadSummary || null,
    tools: [BUILTIN_MAILBOX_SEARCH_TOOL, ...tools, ...browserTools, farinTool].map((tool) => ({
      name: tool.name,
      description: tool.description || 'No description',
      kind: tool.kind,
      readOnly: tool.readOnly,
      skillsMarkdown: tool.skillsMarkdown
    }))
  });
  const planned = await generateStructuredObject({
    messages: messagesPrompt,
    schema: AgentPlanSchema,
    profile: complexity,
    allowFallback: true,
    mock: () => mockPlan(detail.message.subject, suggestion, tools)
  });
  const policy = getAutomationPolicy();
  const normalized = normalizePlanWithPolicy(AgentPlanSchema.parse(planned.object), policy, tools);
  extractAndStoreObligationsForMessage(messageId);
  return createTaskRunFromPlan(messageId, normalized, {
    suggestionId: detail.suggestion?.id ?? null,
    workflowId: parsed.workflow_id ?? null,
    triggerType: parsed.trigger_type,
    actor: parsed.actor,
    approvalMode: parsed.approval_mode,
    idempotencyKey: parsed.idempotency_key || `manual:${messageId}:${randomUUID()}`,
    modelUsed: planned.model,
    providerUsed: planned.provider
  });
}

export function createTaskRunFromPlan(
  messageId: number,
  planInput: AgentPlan,
  metadata: {
    suggestionId?: number | null;
    workflowId?: number | null;
    triggerType?: string;
    actor?: string;
    idempotencyKey?: string | null;
    modelUsed?: string;
    providerUsed?: string;
    approvalMode?: 'always' | 'risk_based' | 'read_only_auto';
  } = {}
) {
  const detail = getMessageDetail(messageId);
  if (!detail?.message) throw new Error('Message not found');
  const tools = listAvailableAgentTools().filter((tool) => tool.isEnabled);
  const policy = getAutomationPolicy();
  const effectivePolicy =
    metadata.approvalMode === 'risk_based'
      ? { ...policy, alwaysRequireApproval: false }
      : metadata.approvalMode === 'read_only_auto'
        ? { ...policy, alwaysRequireApproval: false, autoApproveReadOnlyToolCalls: true }
        : policy;
  const normalized = normalizePlanWithPolicy(AgentPlanSchema.parse(planInput), effectivePolicy, tools);
  const now = nowIso();
  const idempotencyKey =
    metadata.idempotencyKey || `manual:${messageId}:${randomUUID()}`;
  const existing = db
    .select()
    .from(taskRuns)
    .where(eq(taskRuns.idempotencyKey, idempotencyKey))
    .get();
  if (existing) return getTaskRunDetail(existing.id);
  const run = db
    .insert(taskRuns)
    .values({
      messageId,
      suggestionId: metadata.suggestionId ?? detail.suggestion?.id ?? null,
      workflowId: metadata.workflowId ?? null,
      triggerType: metadata.triggerType || 'manual',
      idempotencyKey,
      status: normalized.steps.some((step) => step.requires_approval)
        ? 'needs_approval'
        : 'planned',
      complexity: normalized.complexity,
      modelUsed: metadata.modelUsed || 'workflow-template',
      providerUsed: metadata.providerUsed || 'workflow',
      summary: normalized.summary,
      planJson: JSON.stringify(normalized),
      maxAttempts: policy.defaultMaxAttempts,
      actor: metadata.actor || 'system',
      createdAt: now,
      updatedAt: now
    })
    .returning()
    .get();
  normalized.steps.forEach((step, idx) => {
    db.insert(taskSteps)
      .values({
        taskRunId: run.id,
        stepIndex: idx + 1,
        title: step.title,
        kind: step.kind,
        details: step.details,
        toolName: step.tool_name || null,
        toolInputJson: step.tool_input ? JSON.stringify(step.tool_input) : null,
        dependsOnJson: JSON.stringify(step.depends_on || []),
        conditionJson: step.condition ? JSON.stringify(step.condition) : null,
        outputKey: step.output_key || null,
        status: step.requires_approval ? 'pending' : 'approved',
        requiresApproval: step.requires_approval,
        riskLevel: step.risk_level,
        maxAttempts: step.max_attempts || policy.defaultMaxAttempts,
        retryDelayMs: step.retry_delay_ms || 1000,
        idempotencyKey: `${run.id}:${idx + 1}`,
        approvalReason: step.approval_reason || null,
        outputJson: null,
        errorMessage: null,
        createdAt: now,
        updatedAt: now
      })
      .run();
  });
  recordAgentAudit({
    taskRunId: run.id,
    workflowId: metadata.workflowId ?? null,
    actor: metadata.actor || 'system',
    eventType: 'task_planned',
    payload: { messageId, stepCount: normalized.steps.length, summary: normalized.summary }
  });
  if (normalized.steps.some((step) => step.requires_approval)) {
    createAgentNotification({
      taskRunId: run.id,
      type: 'approval',
      title: 'Workflow approval needed',
      body: `${normalized.steps.filter((step) => step.requires_approval).length} step(s) are waiting for your approval.`
    });
  }
  return getTaskRunDetail(run.id);
}

export function approveTaskRun(id: number, input: unknown = {}) {
  const parsed = TaskApproveSchema.parse(input);
  const run = db.select().from(taskRuns).where(eq(taskRuns.id, id)).get();
  if (!run) return null;
  if (['completed', 'rejected', 'cancelled'].includes(run.status)) return getTaskRunDetail(id);
  const now = nowIso();
  if (parsed.stepId) {
    db.update(taskSteps)
      .set({ status: 'approved', errorMessage: null, nextAttemptAt: null, updatedAt: now })
      .where(and(eq(taskSteps.id, parsed.stepId), eq(taskSteps.taskRunId, id)))
      .run();
  } else {
    db.update(taskSteps)
      .set({ status: 'approved', errorMessage: null, nextAttemptAt: null, updatedAt: now })
      .where(eq(taskSteps.taskRunId, id))
      .run();
  }
  const remainingPending = db
    .select({ id: taskSteps.id })
    .from(taskSteps)
    .where(and(eq(taskSteps.taskRunId, id), eq(taskSteps.status, 'pending')))
    .get();
  db.update(taskRuns)
    .set({
      status: remainingPending ? 'needs_approval' : 'planned',
      cancelRequested: false,
      errorMessage: null,
      updatedAt: now
    })
    .where(eq(taskRuns.id, id))
    .run();
  recordAgentAudit({
    taskRunId: id,
    actor: run.actor,
    eventType: 'task_approved',
    payload: { stepId: parsed.stepId ?? null }
  });
  return getTaskRunDetail(id);
}

export function rejectTaskRun(id: number, input: unknown = {}) {
  const parsed = TaskRunControlSchema.parse(input);
  const run = db.select().from(taskRuns).where(eq(taskRuns.id, id)).get();
  if (!run) return null;
  if (['completed', 'rejected', 'cancelled'].includes(run.status)) return getTaskRunDetail(id);
  const now = nowIso();
  db.update(taskSteps)
    .set({ status: 'rejected', updatedAt: now })
    .where(eq(taskSteps.taskRunId, id))
    .run();
  db.update(taskRuns).set({ status: 'rejected', updatedAt: now }).where(eq(taskRuns.id, id)).run();
  recordAgentAudit({
    taskRunId: id,
    actor: run.actor,
    eventType: 'task_rejected',
    payload: { reason: parsed.reason || null }
  });
  return getTaskRunDetail(id);
}

export function cancelTaskRun(id: number, input: unknown = {}) {
  const parsed = TaskRunControlSchema.parse(input);
  const run = db.select().from(taskRuns).where(eq(taskRuns.id, id)).get();
  if (!run) return null;
  if (['completed', 'rejected', 'cancelled'].includes(run.status)) return getTaskRunDetail(id);
  const now = nowIso();
  db.update(taskRuns)
    .set({
      cancelRequested: true,
      status: run.status === 'running' ? 'running' : 'cancelled',
      errorMessage: parsed.reason || null,
      finishedAt: run.status === 'running' ? null : now,
      updatedAt: now
    })
    .where(eq(taskRuns.id, id))
    .run();
  recordAgentAudit({
    taskRunId: id,
    actor: run.actor,
    eventType: 'task_cancel_requested',
    payload: { reason: parsed.reason || null }
  });
  if (run.status !== 'running') {
    createAgentNotification({
      taskRunId: id,
      type: 'system',
      title: 'Workflow cancelled',
      body: parsed.reason || 'The workflow was cancelled before execution.'
    });
  }
  return getTaskRunDetail(id);
}

export function retryTaskStep(id: number, stepId: number, input: unknown = {}) {
  const parsed = TaskRunControlSchema.parse(input);
  const run = db.select().from(taskRuns).where(eq(taskRuns.id, id)).get();
  const step = db
    .select()
    .from(taskSteps)
    .where(and(eq(taskSteps.id, stepId), eq(taskSteps.taskRunId, id)))
    .get();
  if (!run || !step) return null;
  if (!['failed', 'rejected'].includes(step.status)) return getTaskRunDetail(id);
  if (step.attemptCount >= step.maxAttempts) {
    throw new Error(`Step has reached its maximum of ${step.maxAttempts} attempts`);
  }
  const now = nowIso();
  db.update(taskSteps)
    .set({ status: 'approved', errorMessage: null, nextAttemptAt: null, updatedAt: now })
    .where(eq(taskSteps.id, stepId))
    .run();
  db.update(taskRuns)
    .set({ status: 'planned', errorMessage: null, cancelRequested: false, updatedAt: now })
    .where(eq(taskRuns.id, id))
    .run();
  recordAgentAudit({
    taskRunId: id,
    taskStepId: stepId,
    actor: run.actor,
    eventType: 'task_step_retry_requested',
    payload: { reason: parsed.reason || null }
  });
  return getTaskRunDetail(id);
}

export function resumeTaskRun(id: number, input: unknown = {}) {
  const parsed = TaskRunControlSchema.parse(input);
  const run = db.select().from(taskRuns).where(eq(taskRuns.id, id)).get();
  if (!run) return null;
  if (!['failed', 'planned', 'needs_approval'].includes(run.status)) return getTaskRunDetail(id);
  const failed = db
    .select()
    .from(taskSteps)
    .where(and(eq(taskSteps.taskRunId, id), eq(taskSteps.status, 'failed')))
    .all();
  const now = nowIso();
  for (const step of failed) {
    if (step.attemptCount < step.maxAttempts) {
      db.update(taskSteps)
        .set({ status: 'approved', errorMessage: null, nextAttemptAt: null, updatedAt: now })
        .where(eq(taskSteps.id, step.id))
        .run();
    }
  }
  db.update(taskRuns)
    .set({ status: 'planned', errorMessage: null, cancelRequested: false, nextRunAt: null, updatedAt: now })
    .where(eq(taskRuns.id, id))
    .run();
  recordAgentAudit({
    taskRunId: id,
    actor: run.actor,
    eventType: 'task_resumed',
    payload: { reason: parsed.reason || null }
  });
  return getTaskRunDetail(id);
}

export function editTaskStep(id: number, stepId: number, input: unknown = {}) {
  const parsed = TaskEditSchema.parse(input);
  const run = db.select().from(taskRuns).where(eq(taskRuns.id, id)).get();
  const step = db
    .select()
    .from(taskSteps)
    .where(and(eq(taskSteps.id, stepId), eq(taskSteps.taskRunId, id)))
    .get();
  if (!run || !step) return null;
  if (['completed', 'rejected', 'cancelled', 'running'].includes(run.status)) {
    throw new Error('Only a planned or failed workflow can be edited');
  }
  const now = nowIso();
  db.update(taskSteps)
    .set({
      title: parsed.title ?? step.title,
      details: parsed.details ?? step.details,
      toolName: parsed.tool_name === undefined ? step.toolName : parsed.tool_name,
      toolInputJson:
        parsed.tool_input === undefined ? step.toolInputJson : JSON.stringify(parsed.tool_input),
      dependsOnJson:
        parsed.depends_on === undefined ? step.dependsOnJson : JSON.stringify(parsed.depends_on),
      conditionJson:
        parsed.condition === undefined
          ? step.conditionJson
          : parsed.condition
            ? JSON.stringify(parsed.condition)
            : null,
      outputKey: parsed.output_key === undefined ? step.outputKey : parsed.output_key,
      maxAttempts: parsed.max_attempts ?? step.maxAttempts,
      retryDelayMs: parsed.retry_delay_ms ?? step.retryDelayMs,
      status: step.requiresApproval ? 'pending' : 'approved',
      errorMessage: null,
      updatedAt: now
    })
    .where(eq(taskSteps.id, stepId))
    .run();
  db.update(taskRuns).set({ status: 'needs_approval', updatedAt: now }).where(eq(taskRuns.id, id)).run();
  recordAgentAudit({
    taskRunId: id,
    taskStepId: stepId,
    actor: run.actor,
    eventType: 'task_step_edited',
    payload: parsed
  });
  return getTaskRunDetail(id);
}

export async function executeTaskRun(id: number) {
  const run = db.select().from(taskRuns).where(eq(taskRuns.id, id)).get();
  if (!run) throw new Error('Task run not found');
  if (['completed', 'rejected', 'cancelled'].includes(run.status)) return getTaskRunDetail(id);
  const policy = getAutomationPolicy();
  const now = Date.now();
  if (run.status === 'running' && run.leaseUntil && new Date(run.leaseUntil).getTime() > now) {
    throw new Error('Task run is already executing');
  }
  if (run.cancelRequested) {
    db.update(taskRuns)
      .set({ status: 'cancelled', finishedAt: nowIso(), leaseOwner: null, leaseUntil: null, updatedAt: nowIso() })
      .where(eq(taskRuns.id, id))
      .run();
    return getTaskRunDetail(id);
  }

  const leaseOwner = `agent:${randomUUID()}`;
  const leaseUntil = new Date(now + policy.maxRunDurationMs).toISOString();
  db.update(taskSteps)
    .set({ status: 'approved', updatedAt: nowIso() })
    .where(and(eq(taskSteps.taskRunId, id), eq(taskSteps.status, 'running')))
    .run();
  db.update(taskRuns)
    .set({
      status: 'running',
      attemptCount: run.attemptCount + 1,
      startedAt: run.startedAt || nowIso(),
      leaseOwner,
      leaseUntil,
      errorMessage: null,
      updatedAt: nowIso()
    })
    .where(eq(taskRuns.id, id))
    .run();
  recordAgentAudit({ taskRunId: id, actor: run.actor, eventType: 'task_started', payload: { leaseOwner } });

  const outputs: Array<Record<string, unknown>> = [];
  const message = db.select().from(messages).where(eq(messages.id, run.messageId)).get();
  if (!message) throw new Error('Message not found');

  while (Date.now() < now + policy.maxRunDurationMs) {
    const current = db.select().from(taskRuns).where(eq(taskRuns.id, id)).get();
    if (!current) throw new Error('Task run not found');
    if (current.cancelRequested) {
      db.update(taskRuns)
        .set({ status: 'cancelled', finishedAt: nowIso(), leaseOwner: null, leaseUntil: null, updatedAt: nowIso() })
        .where(eq(taskRuns.id, id))
        .run();
      recordAgentAudit({ taskRunId: id, actor: current.actor, eventType: 'task_cancelled', payload: {} });
      return getTaskRunDetail(id);
    }
    const steps = db
      .select()
      .from(taskSteps)
      .where(eq(taskSteps.taskRunId, id))
      .orderBy(taskSteps.stepIndex)
      .all();
    const runnable = steps.find((step) => {
      if (!['approved', 'running'].includes(step.status)) return false;
      if (step.nextAttemptAt && new Date(step.nextAttemptAt).getTime() > Date.now()) return false;
      const deps = (parseJson(step.dependsOnJson, []) as unknown[]).filter(
        (value): value is number => typeof value === 'number'
      );
      return deps.every((dependency) => {
        const dependencyStep = steps.find((candidate) => candidate.stepIndex === dependency);
        return dependencyStep?.status === 'completed';
      });
    });

    if (!runnable) {
      const pending = steps.some((step) => step.status === 'pending');
      const retryAt = steps
        .map((step) => step.nextAttemptAt)
        .filter(Boolean)
        .sort()[0] as string | undefined;
      const failedDependency = steps.find((step) => {
        const deps = (parseJson(step.dependsOnJson, []) as unknown[]).filter(
          (value): value is number => typeof value === 'number'
        );
        return (
          ['approved', 'running'].includes(step.status) &&
          deps.some((dependency) => steps.find((candidate) => candidate.stepIndex === dependency)?.status === 'failed')
        );
      });
      if (failedDependency) {
        const reason = 'A required dependency failed.';
        db.update(taskSteps)
          .set({ status: 'failed', errorMessage: reason, finishedAt: nowIso(), updatedAt: nowIso() })
          .where(eq(taskSteps.id, failedDependency.id))
          .run();
        db.update(taskRuns)
          .set({ status: 'failed', errorMessage: reason, finishedAt: nowIso(), leaseOwner: null, leaseUntil: null, updatedAt: nowIso() })
          .where(eq(taskRuns.id, id))
          .run();
        createAgentNotification({ taskRunId: id, type: 'failed', title: 'Workflow blocked', body: reason });
        return getTaskRunDetail(id);
      }
      const allDone = steps.every((step) => ['completed', 'rejected'].includes(step.status));
      const retryable = steps.some((step) => step.nextAttemptAt);
      db.update(taskRuns)
        .set({
          status: allDone ? 'completed' : pending ? 'needs_approval' : retryable ? 'planned' : 'failed',
          resultSummary: allDone ? summarizeOutputs(outputs) : current.resultSummary,
          nextRunAt: retryAt || null,
          finishedAt: allDone || (!pending && !retryable) ? nowIso() : null,
          leaseOwner: null,
          leaseUntil: null,
          updatedAt: nowIso()
        })
        .where(eq(taskRuns.id, id))
        .run();
      if (allDone) {
        createAgentNotification({ taskRunId: id, type: 'completed', title: 'Workflow completed', body: summarizeOutputs(outputs) });
        recordAgentAudit({ taskRunId: id, actor: current.actor, eventType: 'task_completed', payload: { outputs } });
      }
      return getTaskRunDetail(id);
    }

    const condition = parseJson(runnable.conditionJson, null);
    const stepContext = buildWorkflowContext(message, current, steps);
    if (!evaluateCondition(condition, stepContext)) {
      const skipped = { skipped: true, reason: 'Condition evaluated false.' };
      db.update(taskSteps)
        .set({ status: 'completed', outputJson: JSON.stringify(skipped), finishedAt: nowIso(), updatedAt: nowIso() })
        .where(eq(taskSteps.id, runnable.id))
        .run();
      outputs.push({ stepId: runnable.id, output: skipped });
      recordAgentAudit({
        taskRunId: id,
        taskStepId: runnable.id,
        actor: current.actor,
        eventType: 'task_step_skipped',
        payload: skipped
      });
      continue;
    }
    const input = resolveTemplates((parseJson(runnable.toolInputJson, {}) || {}) as Record<string, unknown>, stepContext);
    db.update(taskSteps)
      .set({
        status: 'running',
        attemptCount: runnable.attemptCount + 1,
        resolvedInputJson: JSON.stringify(input),
        startedAt: runnable.startedAt || nowIso(),
        errorMessage: null,
        updatedAt: nowIso()
      })
      .where(eq(taskSteps.id, runnable.id))
      .run();
    try {
      const resolvedStep = {
        ...runnable,
        title: resolveTemplates(runnable.title, stepContext),
        details: resolveTemplates(runnable.details, stepContext)
      };
      const output = await executeStep(message, current, resolvedStep, input);
      outputs.push({ stepId: runnable.id, output });
      db.update(taskSteps)
        .set({
          status: 'completed',
          outputJson: JSON.stringify(output),
          errorMessage: null,
          nextAttemptAt: null,
          finishedAt: nowIso(),
          updatedAt: nowIso()
        })
        .where(eq(taskSteps.id, runnable.id))
        .run();
      db.update(taskRuns)
        .set({ currentStepIndex: runnable.stepIndex, updatedAt: nowIso() })
        .where(eq(taskRuns.id, id))
        .run();
      recordAgentAudit({
        taskRunId: id,
        taskStepId: runnable.id,
        actor: current.actor,
        eventType: 'task_step_completed',
        payload: { output }
      });
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      const attempt = runnable.attemptCount + 1;
      const canRetry = attempt < runnable.maxAttempts;
      const nextAttemptAt = canRetry
        ? new Date(Date.now() + Math.max(100, runnable.retryDelayMs) * 2 ** Math.max(0, attempt - 1)).toISOString()
        : null;
      db.update(taskSteps)
        .set({
          status: canRetry ? 'approved' : 'failed',
          attemptCount: attempt,
          errorMessage: messageText,
          nextAttemptAt,
          finishedAt: canRetry ? null : nowIso(),
          updatedAt: nowIso()
        })
        .where(eq(taskSteps.id, runnable.id))
        .run();
      db.update(taskRuns)
        .set({
          status: canRetry ? 'planned' : 'failed',
          errorMessage: messageText,
          nextRunAt: nextAttemptAt,
          finishedAt: canRetry ? null : nowIso(),
          leaseOwner: null,
          leaseUntil: null,
          updatedAt: nowIso()
        })
        .where(eq(taskRuns.id, id))
        .run();
      recordAgentAudit({
        taskRunId: id,
        taskStepId: runnable.id,
        actor: current.actor,
        eventType: canRetry ? 'task_step_retry_scheduled' : 'task_failed',
        payload: { error: messageText, attempt, nextAttemptAt }
      });
      createAgentNotification({
        taskRunId: id,
        taskStepId: runnable.id,
        type: canRetry ? 'system' : 'failed',
        title: canRetry ? 'Workflow retry scheduled' : 'Workflow failed',
        body: messageText
      });
      return getTaskRunDetail(id);
    }
  }
  db.update(taskRuns)
    .set({ status: 'failed', errorMessage: 'Workflow exceeded its execution time budget.', finishedAt: nowIso(), leaseOwner: null, leaseUntil: null, updatedAt: nowIso() })
    .where(eq(taskRuns.id, id))
    .run();
  createAgentNotification({ taskRunId: id, type: 'failed', title: 'Workflow timed out', body: 'The workflow exceeded its configured time budget.' });
  return getTaskRunDetail(id);
}

async function executeStep(
  message: typeof messages.$inferSelect,
  run: typeof taskRuns.$inferSelect,
  step: typeof taskSteps.$inferSelect,
  input: Record<string, unknown>
) {
  const workflow = run.workflowId
    ? db.select().from(automationWorkflows).where(eq(automationWorkflows.id, run.workflowId)).get()
    : null;
  if (
    workflow?.dryRun &&
    [
      'draft_reply',
      'send_reply',
      'move_to_folder',
      'browser_recipe',
      'farin_upload',
      'delegate',
      'mark_done',
      'notify'
    ].includes(step.kind)
  ) {
    const preview = step.kind === 'draft_reply' ? String(input.draft || step.details) : null;
    return {
      dryRun: true,
      action: step.kind,
      preview,
      ...(step.kind === 'browser_recipe'
        ? { recipeId: parseRecipeId(step.toolName, input) }
        : {}),
      ...(step.kind === 'farin_upload'
        ? { filePath: typeof input.file_path === 'string' ? input.file_path : input.filePath || null }
        : {})
    };
  }
  if (step.kind === 'draft_reply') {
    const body = String(input.draft || step.details);
    const draft = upsertDraft({
      accountId: message.accountId,
      mode: 'reply',
      sourceMessageId: message.id,
      to: String(input.to || message.from),
      cc: typeof input.cc === 'string' ? input.cc : null,
      bcc: typeof input.bcc === 'string' ? input.bcc : null,
      subject: String(input.subject || `Re: ${message.subject}`),
      bodyText: body,
      bodyHtml: typeof input.bodyHtml === 'string' ? input.bodyHtml : null,
      attachments: []
    });
    return { draftId: draft?.id ?? null, draft: body };
  }
  if (step.kind === 'send_reply') {
    const body = String(input.body || input.draft || step.details);
    if (!body.trim()) throw new Error('send_reply step requires body');
    return sendComposedMessage({
      accountId: message.accountId,
      to: String(input.to || message.from),
      cc: typeof input.cc === 'string' ? input.cc : null,
      bcc: typeof input.bcc === 'string' ? input.bcc : null,
      subject: String(input.subject || `Re: ${message.subject}`),
      body,
      bodyHtml: typeof input.bodyHtml === 'string' ? input.bodyHtml : null,
      attachments: [],
      mode: 'reply',
      sourceMessageId: message.id
    });
  }
  if (step.kind === 'move_to_folder') {
    const folderPath =
      typeof input.folderPath === 'string'
        ? input.folderPath
        : inferFolderFromDetails(step.details);
    if (!folderPath) throw new Error('move_to_folder step requires folderPath');
    const moved = await moveMessage(message.id, folderPath);
    return { movedTo: moved?.folderPath || folderPath };
  }
  if (step.kind === 'tool_call') {
    if (!step.toolName) throw new Error('tool_call step missing tool_name');
    if (step.toolName === BUILTIN_MAILBOX_SEARCH_TOOL.name) {
      const query = typeof input.query === 'string' ? input.query : null;
      const sender = typeof input.sender === 'string' ? input.sender : null;
      const subject = typeof input.subject === 'string' ? input.subject : null;
      const limit =
        typeof input.limit === 'number' && Number.isFinite(input.limit)
          ? Math.max(1, Math.min(20, Math.floor(input.limit)))
          : 8;
      const rows = searchRelatedEmailsForAgent({ messageId: message.id, query, sender, subject, limit });
      db.insert(toolCalls)
        .values({
          taskRunId: run.id,
          taskStepId: step.id,
          toolId: null,
          toolName: BUILTIN_MAILBOX_SEARCH_TOOL.name,
          requestJson: JSON.stringify(input),
          responseJson: JSON.stringify({ count: rows.length, results: rows }),
          status: 'completed',
          durationMs: 0,
          createdAt: nowIso()
        })
        .run();
      return { query, sender, subject, count: rows.length, results: rows };
    }
    const tool = getAvailableAgentToolByName(step.toolName);
    if (!tool) throw new Error(`Tool "${step.toolName}" not found or disabled`);
    const executed = await executeTool(tool, input, { taskRunId: run.id, taskStepId: step.id });
    if (!executed.ok) throw new Error(JSON.stringify(executed.output));
    return executed.output;
  }
  if (step.kind === 'browser_recipe') {
    const recipeId = parseRecipeId(step.toolName, input);
    if (!recipeId) throw new Error('browser_recipe step requires tool_name browser_recipe:<id> or recipeId');
    return runBrowserRecipe(recipeId, {
      taskRunId: run.id,
      taskStepId: step.id,
      headless: true
    });
  }
  if (step.kind === 'farin_upload') {
    const filePath =
      typeof input.file_path === 'string'
        ? input.file_path
        : typeof input.filePath === 'string'
          ? input.filePath
          : null;
    if (!filePath) throw new Error('farin_upload step requires file_path from a browser_recipe output');
    return uploadFarinFile({
      filePath,
      filename: typeof input.filename === 'string' ? input.filename : undefined,
      companyId: typeof input.company_id === 'string' ? input.company_id : undefined,
      force: input.force === true,
      taskRunId: run.id,
      taskStepId: step.id
    });
  }
  if (step.kind === 'delegate') {
    return dispatchDelegateForAgent(message.id, run.suggestionId || 0, String(input.instructions || step.details));
  }
  if (step.kind === 'notify') {
    const notification = createAgentNotification({
      taskRunId: run.id,
      taskStepId: step.id,
      type: 'system',
      title: String(input.title || step.title),
      body: String(input.body || step.details)
    });
    return { notificationId: notification?.id ?? null };
  }
  if (step.kind === 'mark_done') {
    const now = nowIso();
    const obligations = db
      .update(agentObligations)
      .set({ status: 'done', updatedAt: now })
      .where(and(eq(agentObligations.messageId, message.id), eq(agentObligations.status, 'open')))
      .run().changes;
    const reminders = db
      .update(followUpReminders)
      .set({ status: 'done', updatedAt: now })
      .where(and(eq(followUpReminders.messageId, message.id), eq(followUpReminders.status, 'open')))
      .run().changes;
    return { done: true, obligations, reminders, note: step.details };
  }
  throw new Error(`Unsupported task step kind: ${step.kind}`);
}

function parseRecipeId(toolName: string | null, input: Record<string, unknown>) {
  const fromTool = toolName?.match(/^browser_recipe:(\d+)$/)?.[1];
  const raw = fromTool || input.recipeId || input.recipe_id;
  const recipeId = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  return Number.isInteger(recipeId) && recipeId > 0 ? recipeId : null;
}

function classifyComplexity(subject: string, bodyText: string, note: string | null) {
  const haystack = `${subject}\n${bodyText}\n${note || ''}`.toLowerCase();
  const keywords = [
    'contract',
    'chargeback',
    'refund',
    'legal',
    'tax',
    'erp',
    'credit memo',
    'multi-step',
    'escalation',
    'angry',
    'sensitive'
  ];
  if (bodyText.length > 2000 || keywords.some((keyword) => haystack.includes(keyword)))
    return 'advanced' as const;
  return 'primary' as const;
}

function mockPlan(
  subject: string,
  suggestion: EmailSuggestion | null,
  tools: Array<{ name: string; readOnly: boolean }>
): AgentPlan {
  const lower = subject.toLowerCase();
  const tool = tools.find((candidate) => candidate.name !== 'obsidian_vault') || tools[0];
  if (tool && (lower.includes('credit') || lower.includes('erp') || lower.includes('refund'))) {
    return {
      summary: 'Collect context and prepare a tool-assisted resolution draft.',
      complexity: 'advanced',
      requires_user_approval: true,
      final_reply_draft: null,
      max_turns: 8,
      steps: [
        {
          title: 'Gather ERP context',
          kind: 'tool_call',
          details: 'Run ERP context lookup for the customer and transaction.',
          tool_name: tool.name,
          tool_input: { action: 'lookup_customer_context' },
          depends_on: [],
          condition: null,
          output_key: 'customer_context',
          max_attempts: 3,
          retry_delay_ms: 1000,
          requires_approval: true,
          risk_level: 'medium'
        },
        {
          title: 'Draft customer response',
          kind: 'draft_reply',
          details:
            suggestion?.draft_reply || 'Prepare a concise response with next steps and timeline.',
          tool_name: null,
          tool_input: { draft: suggestion?.draft_reply || null },
          depends_on: [1],
          condition: null,
          output_key: 'draft',
          max_attempts: 3,
          retry_delay_ms: 1000,
          requires_approval: true,
          risk_level: 'medium'
        }
      ]
    };
  }
  const action = suggestion?.recommended_action;
  if (action === 'move_to_folder' && suggestion?.target_folder) {
    return {
      summary: `File this message into ${suggestion.target_folder}.`,
      complexity: 'simple',
      requires_user_approval: true,
      final_reply_draft: null,
      max_turns: 8,
      steps: [
        {
          title: 'Move message',
          kind: 'move_to_folder',
          details: `Move this message to ${suggestion.target_folder}.`,
          tool_name: null,
          tool_input: { folderPath: suggestion.target_folder },
          depends_on: [],
          condition: null,
          output_key: null,
          max_attempts: 3,
          retry_delay_ms: 1000,
          requires_approval: true,
          risk_level: suggestion.risk_level
        }
      ]
    };
  }
  return {
    summary: 'Prepare a reviewed response and mark task complete.',
    complexity: 'simple',
    requires_user_approval: true,
    final_reply_draft: suggestion?.draft_reply || null,
    max_turns: 8,
    steps: [
      {
        title: 'Draft reply',
        kind: 'draft_reply',
        details: suggestion?.draft_reply || 'Draft a concise reply with the next action.',
        tool_name: null,
        tool_input: { draft: suggestion?.draft_reply || null },
        depends_on: [],
        condition: null,
        output_key: 'draft',
        max_attempts: 3,
        retry_delay_ms: 1000,
        requires_approval: true,
        risk_level: suggestion?.risk_level || 'low'
      },
      {
        title: 'Mark complete',
        kind: 'mark_done',
        details: 'After review, mark this task as complete.',
        tool_name: null,
        tool_input: null,
        depends_on: [1],
        condition: null,
        output_key: null,
        max_attempts: 3,
        retry_delay_ms: 1000,
        requires_approval: true,
        risk_level: 'low'
      }
    ]
  };
}

function suggestionToShape(suggestion: typeof aiSuggestions.$inferSelect): EmailSuggestion {
  return {
    category: suggestion.category,
    confidence: suggestion.confidence,
    recommended_action: suggestion.recommendedAction,
    target_folder: suggestion.targetFolder,
    draft_reply: suggestion.draftReply,
    forward_to: suggestion.forwardTo,
    delegate_instructions: suggestion.delegateInstructions,
    reasoning_summary: suggestion.reasoningSummary,
    risk_level: suggestion.riskLevel
  };
}

function normalizePlanWithPolicy(
  plan: AgentPlan,
  policy: {
    alwaysRequireApproval: boolean;
    autoApproveReadOnlyToolCalls: boolean;
    maxAgentTurns: number;
  },
  tools: Array<{ name: string; readOnly: boolean; requireApprovalForWrite?: boolean }>
) {
  const toolMap = new Map(tools.map((tool) => [tool.name, tool]));
  const steps = plan.steps.map((step, index) => {
    let requiresApproval = step.requires_approval || policy.alwaysRequireApproval;
    const decision = assessAgentAction({
      action: step.kind === 'tool_call' ? 'tool_call' : step.kind,
      subject: step.title,
      bodyText: step.details,
      toolReadOnly: step.tool_name ? toolMap.get(step.tool_name)?.readOnly ?? true : true
    });
    const riskLevel = highestRisk(step.risk_level, decision.riskLevel);
    if (decision.requiresApproval) requiresApproval = true;
    if (isNonDestructiveInternalStep(step.kind) && !decision.requiresApproval) {
      requiresApproval = false;
    }
    if (step.kind === 'tool_call' && step.tool_name && policy.autoApproveReadOnlyToolCalls) {
      const tool = toolMap.get(step.tool_name);
      if ((tool?.readOnly || tool?.requireApprovalForWrite === false) && !decision.requiresApproval) {
        requiresApproval = false;
      }
    }
    const dependsOn = (step.depends_on || []).filter(
      (dependency) => dependency >= 1 && dependency <= index
    );
    return {
      ...step,
      depends_on: dependsOn,
      condition: step.condition || null,
      output_key: step.output_key || null,
      max_attempts: step.max_attempts || 3,
      retry_delay_ms: step.retry_delay_ms || 1000,
      approval_reason: requiresApproval
        ? step.approval_reason || decision.reasons.join(' ')
        : null,
      risk_level: riskLevel,
      requires_approval: requiresApproval
    };
  });
  return {
    ...plan,
    max_turns: Math.min(plan.max_turns, policy.maxAgentTurns),
    requires_user_approval: steps.some((step) => step.requires_approval),
    steps
  };
}

function highestRisk(
  a: AgentPlan['steps'][number]['risk_level'],
  b: AgentPlan['steps'][number]['risk_level']
) {
  const order = { low: 1, medium: 2, high: 3 };
  return order[a] >= order[b] ? a : b;
}

function getAutomationPolicy() {
  const policy = db.select().from(automationPolicies).orderBy(automationPolicies.id).get();
  return {
    alwaysRequireApproval: policy?.alwaysRequireApproval ?? true,
    autoApproveReadOnlyToolCalls: policy?.autoApproveReadOnlyToolCalls ?? true,
    defaultMaxAttempts: Math.max(1, policy?.defaultMaxAttempts ?? 3),
    maxRunDurationMs: Math.max(1000, policy?.maxRunDurationMs ?? 180000),
    maxAgentTurns: Math.max(1, policy?.maxAgentTurns ?? 8)
  };
}

function isNonDestructiveInternalStep(kind: AgentPlan['steps'][number]['kind']) {
  return kind === 'draft_reply' || kind === 'mark_done' || kind === 'notify';
}

function buildWorkflowContext(
  message: typeof messages.$inferSelect,
  run: typeof taskRuns.$inferSelect,
  steps: Array<typeof taskSteps.$inferSelect>
): WorkflowContext {
  const stepContext: Record<string, unknown> = {};
  const outputs: Record<string, unknown> = {};
  for (const step of steps) {
    const output = parseJson(step.outputJson, null);
    stepContext[String(step.stepIndex)] = {
      status: step.status,
      output,
      error: step.errorMessage,
      attempts: step.attemptCount
    };
    if (step.outputKey && output !== null) outputs[step.outputKey] = output;
  }
  return {
    message: {
      id: message.id,
      accountId: message.accountId,
      subject: message.subject,
      from: message.from,
      to: message.to,
      cc: message.cc,
      date: message.date,
      body: message.bodyText,
      folderPath: message.folderPath
    },
    run: {
      id: run.id,
      status: run.status,
      triggerType: run.triggerType,
      attemptCount: run.attemptCount
    },
    steps: stepContext,
    outputs,
    now: nowIso()
  };
}

function safeParseJson(value: string | null | undefined) {
  return parseJson(value, null);
}

function inferFolderFromDetails(details: string) {
  const match = details.match(/to\s+([A-Za-z0-9 _-]+)\.?$/i);
  return match?.[1]?.trim() || null;
}

function summarizeOutputs(outputs: Array<Record<string, unknown>>) {
  if (!outputs.length) return 'No executable steps completed.';
  return `Completed ${outputs.length} step(s).`;
}
