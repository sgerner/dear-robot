import { and, desc, inArray, isNull } from 'drizzle-orm';
import { db, nowIso } from '../db';
import { agentAuditEvents, agentNotifications, automationPolicies } from '../db/schema';
import type { AgentCondition } from './schema';

export type WorkflowContext = {
  message?: Record<string, unknown> | null;
  run?: Record<string, unknown> | null;
  outputs?: Record<string, unknown>;
  steps?: Record<string, unknown>;
  [key: string]: unknown;
};

export function parseJson(value: string | null | undefined, fallback: unknown = null) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function getPath(source: unknown, path: string) {
  const normalized = path
    .replace(/^\$\.?/, '')
    .replace(/^context\.?/, '')
    .replace(/^steps\.(\d+)\./, 'steps.$1.')
    .trim();
  if (!normalized) return source;
  if (
    normalized.startsWith('outputs.') &&
    source &&
    typeof source === 'object' &&
    'outputs' in source
  ) {
    let current: unknown = (source as Record<string, unknown>).outputs;
    for (const part of normalized.slice('outputs.'.length).split('.').filter(Boolean)) {
      if (current && typeof current === 'object' && part in current) {
        current = (current as Record<string, unknown>)[part];
      } else if (Array.isArray(current) && /^\d+$/.test(part)) {
        current = current[Number(part)];
      } else {
        return undefined;
      }
    }
    return current;
  }
  const parts = normalized.split('.').filter(Boolean);
  let current: unknown = source;
  for (const part of parts) {
    if (current && typeof current === 'object' && part in current) {
      current = (current as Record<string, unknown>)[part];
      continue;
    }
    if (Array.isArray(current) && /^\d+$/.test(part)) {
      current = current[Number(part)];
      continue;
    }
    return undefined;
  }
  return current;
}

function stringifyTemplateValue(value: unknown) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Resolve only data references; executable expressions are deliberately unsupported. */
export function resolveTemplates<T>(value: T, context: WorkflowContext): T {
  if (typeof value === 'string') {
    const exact = value.match(/^\{\{\s*([^}]+?)\s*\}\}$/);
    if (exact) return getPath(context, exact[1]) as T;
    return value.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, path: string) => {
      return stringifyTemplateValue(getPath(context, path));
    }) as T;
  }
  if (Array.isArray(value)) return value.map((item) => resolveTemplates(item, context)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        resolveTemplates(item, context)
      ])
    ) as T;
  }
  return value;
}

export function evaluateCondition(condition: AgentCondition | null | undefined, context: WorkflowContext) {
  if (!condition) return true;
  const actual = getPath(context, condition.path);
  switch (condition.operator) {
    case 'exists':
      return actual !== undefined && actual !== null;
    case 'not_exists':
      return actual === undefined || actual === null;
    case 'truthy':
      return Boolean(actual);
    case 'falsy':
      return !actual;
    case 'equals':
      return JSON.stringify(actual) === JSON.stringify(condition.value);
    case 'not_equals':
      return JSON.stringify(actual) !== JSON.stringify(condition.value);
    case 'contains':
      if (Array.isArray(actual)) return actual.some((item) => JSON.stringify(item) === JSON.stringify(condition.value));
      return typeof actual === 'string' && actual.includes(String(condition.value ?? ''));
    default:
      return false;
  }
}

export function recordAgentAudit(input: {
  workflowId?: number | null;
  taskRunId?: number | null;
  taskStepId?: number | null;
  actor?: string;
  eventType: string;
  payload?: unknown;
}) {
  return db
    .insert(agentAuditEvents)
    .values({
      workflowId: input.workflowId ?? null,
      taskRunId: input.taskRunId ?? null,
      taskStepId: input.taskStepId ?? null,
      actor: input.actor || 'system',
      eventType: input.eventType,
      payloadJson: JSON.stringify(input.payload ?? {}),
      createdAt: nowIso()
    })
    .returning()
    .get();
}

export function createAgentNotification(input: {
  taskRunId?: number | null;
  taskStepId?: number | null;
  type: 'approval' | 'failed' | 'completed' | 'follow_up' | 'system';
  title: string;
  body: string;
}) {
  const policy = db
    .select({ enabled: automationPolicies.notificationEnabled })
    .from(automationPolicies)
    .orderBy(automationPolicies.id)
    .get();
  if (policy && !policy.enabled) return null;
  return db
    .insert(agentNotifications)
    .values({
      taskRunId: input.taskRunId ?? null,
      taskStepId: input.taskStepId ?? null,
      type: input.type,
      title: input.title,
      body: input.body,
      readAt: null,
      createdAt: nowIso()
    })
    .returning()
    .get();
}

export function listAgentNotifications(options: { unreadOnly?: boolean; limit?: number } = {}) {
  return db
    .select()
    .from(agentNotifications)
    .where(options.unreadOnly ? isNull(agentNotifications.readAt) : undefined)
    .orderBy(desc(agentNotifications.createdAt))
    .limit(Math.min(200, Math.max(1, options.limit || 50)))
    .all();
}

export function markAgentNotificationsRead(ids: number[]) {
  if (!ids.length) return { updated: 0 };
  const now = nowIso();
  const result = db
    .update(agentNotifications)
    .set({ readAt: now })
    .where(and(isNull(agentNotifications.readAt), inArray(agentNotifications.id, ids)))
    .run();
  return { updated: result.changes };
}

export function isWithinQuietHours(
  date: Date,
  start: string | null | undefined,
  end: string | null | undefined,
  timezone = 'UTC'
) {
  if (!start || !end) return false;
  try {
    const formatted = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      hourCycle: 'h23'
    }).format(date);
    const [hour, minute] = formatted.split(':').map(Number);
    const current = hour * 60 + minute;
    const parse = (value: string) => {
      const [h, m] = value.split(':').map(Number);
      return h * 60 + m;
    };
    const from = parse(start);
    const to = parse(end);
    return from <= to ? current >= from && current < to : current >= from || current < to;
  } catch {
    return false;
  }
}
