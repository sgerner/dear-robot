import { and, desc, eq } from 'drizzle-orm';
import { generateStructuredObject } from '../ai/provider';
import { type EmailSuggestion } from '../ai/schema';
import { db, nowIso } from '../db';
import { aiSuggestions, automationPolicies, messages, taskRuns, taskSteps } from '../db/schema';
import { readAgentInstructions } from '../memory';
import { buildMemoryPromptContext } from '../memory-learning';
import { getMessageDetail, listFoldersWithCounts, moveMessage } from '../services/messages';
import { buildAgentPlanMessages } from './prompts';
import { AgentPlanSchema, TaskApproveSchema, TaskPlanInputSchema, type AgentPlan } from './schema';
import { executeTool, getAgentToolByName, listAgentTools } from './tools';

export function listTaskRuns(messageId?: number, limit = 50) {
  return db
    .select({
      id: taskRuns.id,
      messageId: taskRuns.messageId,
      status: taskRuns.status,
      complexity: taskRuns.complexity,
      modelUsed: taskRuns.modelUsed,
      providerUsed: taskRuns.providerUsed,
      summary: taskRuns.summary,
      resultSummary: taskRuns.resultSummary,
      errorMessage: taskRuns.errorMessage,
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

export async function createTaskPlanForMessage(messageId: number, input: unknown = {}) {
  const parsed = TaskPlanInputSchema.parse(input);
  const detail = getMessageDetail(messageId);
  if (!detail?.message) throw new Error('Message not found');
  const suggestion = detail.suggestion ? suggestionToShape(detail.suggestion) : null;
  const accountFolders = listFoldersWithCounts(detail.message.accountId).map(
    (folder) => folder.path
  );
  const tools = listAgentTools().filter((tool) => tool.isEnabled);
  const complexity = classifyComplexity(
    detail.message.subject,
    detail.message.bodyText,
    parsed.note || null
  );
  const messagesPrompt = buildAgentPlanMessages({
    agentInstructions: readAgentInstructions(),
    memoryContext: buildMemoryPromptContext({
      subject: detail.message.subject,
      bodyText: detail.message.bodyText,
      note: parsed.note || null
    }).text,
    subject: detail.message.subject,
    sender: detail.message.from,
    recipients: detail.message.to,
    cc: detail.message.cc || null,
    date: detail.message.date,
    bodyText: detail.message.bodyText,
    availableFolders: accountFolders,
    existingSuggestion: suggestion,
    note: parsed.note || null,
    tools: tools.map((tool) => ({
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
  const now = nowIso();
  const normalized = normalizePlanWithPolicy(AgentPlanSchema.parse(planned.object), policy, tools);
  const run = db
    .insert(taskRuns)
    .values({
      messageId,
      suggestionId: detail.suggestion?.id ?? null,
      status: normalized.steps.some((step) => step.requires_approval)
        ? 'needs_approval'
        : 'planned',
      complexity: normalized.complexity,
      modelUsed: planned.model,
      providerUsed: planned.provider,
      summary: normalized.summary,
      planJson: JSON.stringify(normalized),
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
        status: step.requires_approval ? 'pending' : 'approved',
        requiresApproval: step.requires_approval,
        riskLevel: step.risk_level,
        outputJson: null,
        errorMessage: null,
        createdAt: now,
        updatedAt: now
      })
      .run();
  });
  return getTaskRunDetail(run.id);
}

export function approveTaskRun(id: number, input: unknown = {}) {
  const parsed = TaskApproveSchema.parse(input);
  const run = db.select().from(taskRuns).where(eq(taskRuns.id, id)).get();
  if (!run) return null;
  const now = nowIso();
  if (parsed.stepId) {
    db.update(taskSteps)
      .set({ status: 'approved', updatedAt: now })
      .where(and(eq(taskSteps.id, parsed.stepId), eq(taskSteps.taskRunId, id)))
      .run();
  } else {
    db.update(taskSteps)
      .set({ status: 'approved', updatedAt: now })
      .where(eq(taskSteps.taskRunId, id))
      .run();
  }
  const remainingPending = db
    .select({ id: taskSteps.id })
    .from(taskSteps)
    .where(and(eq(taskSteps.taskRunId, id), eq(taskSteps.status, 'pending')))
    .get();
  db.update(taskRuns)
    .set({ status: remainingPending ? 'needs_approval' : 'planned', updatedAt: now })
    .where(eq(taskRuns.id, id))
    .run();
  return getTaskRunDetail(id);
}

export function rejectTaskRun(id: number) {
  const run = db.select().from(taskRuns).where(eq(taskRuns.id, id)).get();
  if (!run) return null;
  const now = nowIso();
  db.update(taskSteps)
    .set({ status: 'rejected', updatedAt: now })
    .where(eq(taskSteps.taskRunId, id))
    .run();
  db.update(taskRuns).set({ status: 'rejected', updatedAt: now }).where(eq(taskRuns.id, id)).run();
  return getTaskRunDetail(id);
}

export async function executeTaskRun(id: number) {
  const run = db.select().from(taskRuns).where(eq(taskRuns.id, id)).get();
  if (!run) throw new Error('Task run not found');
  const steps = db
    .select()
    .from(taskSteps)
    .where(eq(taskSteps.taskRunId, id))
    .orderBy(taskSteps.stepIndex)
    .all();
  const pending = steps.find((step) => step.status === 'pending');
  if (pending) throw new Error('Task run still has pending approvals');
  db.update(taskRuns)
    .set({ status: 'running', updatedAt: nowIso(), errorMessage: null })
    .where(eq(taskRuns.id, id))
    .run();
  const outputs: Array<Record<string, unknown>> = [];
  for (const step of steps) {
    if (!['approved', 'running'].includes(step.status)) continue;
    db.update(taskSteps)
      .set({ status: 'running', updatedAt: nowIso(), errorMessage: null })
      .where(eq(taskSteps.id, step.id))
      .run();
    try {
      const output = await executeStep(run.messageId, id, step);
      outputs.push({ stepId: step.id, output });
      db.update(taskSteps)
        .set({
          status: 'completed',
          outputJson: JSON.stringify(output),
          updatedAt: nowIso()
        })
        .where(eq(taskSteps.id, step.id))
        .run();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      db.update(taskSteps)
        .set({
          status: 'failed',
          errorMessage: message,
          updatedAt: nowIso()
        })
        .where(eq(taskSteps.id, step.id))
        .run();
      db.update(taskRuns)
        .set({
          status: 'failed',
          errorMessage: message,
          updatedAt: nowIso()
        })
        .where(eq(taskRuns.id, id))
        .run();
      return getTaskRunDetail(id);
    }
  }
  db.update(taskRuns)
    .set({
      status: 'completed',
      resultSummary: summarizeOutputs(outputs),
      updatedAt: nowIso()
    })
    .where(eq(taskRuns.id, id))
    .run();
  return getTaskRunDetail(id);
}

async function executeStep(
  messageId: number,
  taskRunId: number,
  step: typeof taskSteps.$inferSelect
) {
  const input = (safeParseJson(step.toolInputJson) || {}) as Record<string, unknown>;
  if (step.kind === 'draft_reply') {
    return { draft: input.draft || step.details };
  }
  if (step.kind === 'move_to_folder') {
    const folderPath =
      typeof input.folderPath === 'string'
        ? input.folderPath
        : inferFolderFromDetails(step.details);
    if (!folderPath) throw new Error('move_to_folder step requires folderPath');
    const moved = await moveMessage(messageId, folderPath);
    return { movedTo: moved?.folderPath || folderPath };
  }
  if (step.kind === 'tool_call') {
    if (!step.toolName) throw new Error('tool_call step missing tool_name');
    const tool = getAgentToolByName(step.toolName);
    if (!tool) throw new Error(`Tool "${step.toolName}" not found or disabled`);
    const executed = await executeTool(tool, input, { taskRunId, taskStepId: step.id });
    if (!executed.ok) throw new Error(JSON.stringify(executed.output));
    return executed.output;
  }
  if (step.kind === 'delegate') {
    return { delegated: true, note: step.details };
  }
  return { done: true, note: step.details };
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
  const tool = tools[0];
  if (tool && (lower.includes('credit') || lower.includes('erp') || lower.includes('refund'))) {
    return {
      summary: 'Collect context and prepare a tool-assisted resolution draft.',
      complexity: 'advanced',
      requires_user_approval: true,
      final_reply_draft: null,
      steps: [
        {
          title: 'Gather ERP context',
          kind: 'tool_call',
          details: 'Run ERP context lookup for the customer and transaction.',
          tool_name: tool.name,
          tool_input: { action: 'lookup_customer_context' },
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
      steps: [
        {
          title: 'Move message',
          kind: 'move_to_folder',
          details: `Move this message to ${suggestion.target_folder}.`,
          tool_name: null,
          tool_input: { folderPath: suggestion.target_folder },
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
    steps: [
      {
        title: 'Draft reply',
        kind: 'draft_reply',
        details: suggestion?.draft_reply || 'Draft a concise reply with the next action.',
        tool_name: null,
        tool_input: { draft: suggestion?.draft_reply || null },
        requires_approval: true,
        risk_level: suggestion?.risk_level || 'low'
      },
      {
        title: 'Mark complete',
        kind: 'mark_done',
        details: 'After review, mark this task as complete.',
        tool_name: null,
        tool_input: null,
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
  policy: { alwaysRequireApproval: boolean; autoApproveReadOnlyToolCalls: boolean },
  tools: Array<{ name: string; readOnly: boolean; requireApprovalForWrite?: boolean }>
) {
  const toolMap = new Map(tools.map((tool) => [tool.name, tool]));
  const steps = plan.steps.map((step) => {
    let requiresApproval = step.requires_approval || policy.alwaysRequireApproval;
    if (isNonDestructiveInternalStep(step.kind)) requiresApproval = false;
    if (step.kind === 'tool_call' && step.tool_name && policy.autoApproveReadOnlyToolCalls) {
      const tool = toolMap.get(step.tool_name);
      if (tool?.readOnly || tool?.requireApprovalForWrite === false) requiresApproval = false;
    }
    return { ...step, requires_approval: requiresApproval };
  });
  return { ...plan, requires_user_approval: steps.some((step) => step.requires_approval), steps };
}

function getAutomationPolicy() {
  const policy = db.select().from(automationPolicies).orderBy(automationPolicies.id).get();
  return {
    alwaysRequireApproval: policy?.alwaysRequireApproval ?? true,
    autoApproveReadOnlyToolCalls: policy?.autoApproveReadOnlyToolCalls ?? true
  };
}

function isNonDestructiveInternalStep(kind: AgentPlan['steps'][number]['kind']) {
  return kind === 'draft_reply' || kind === 'mark_done';
}

function safeParseJson(value: string | null | undefined) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function inferFolderFromDetails(details: string) {
  const match = details.match(/to\s+([A-Za-z0-9 _-]+)\.?$/i);
  return match?.[1]?.trim() || null;
}

function summarizeOutputs(outputs: Array<Record<string, unknown>>) {
  if (!outputs.length) return 'No executable steps completed.';
  return `Completed ${outputs.length} step(s).`;
}
