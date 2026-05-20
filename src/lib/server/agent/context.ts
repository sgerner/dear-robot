import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db';
import {
  agentObligations,
  contacts,
  followUpReminders,
  outcomeEvents,
  taskRuns,
  threadSummaries,
  toolCalls
} from '../db/schema';
import { buildMemoryPromptContext } from '../memory-learning';
import { getMessageDetail, searchRelatedEmailsForAgent } from '../services/messages';

export type UnifiedAgentContext = ReturnType<typeof buildUnifiedAgentContext>;

export function buildUnifiedAgentContext(
  messageId: number,
  options: { note?: string | null; includeBody?: boolean; relatedLimit?: number } = {}
) {
  const detail = getMessageDetail(messageId);
  if (!detail?.message) return null;
  const message = detail.message;
  const senderEmail = extractEmail(message.from);
  const subjectQuery = normalizeSubjectForSearch(message.subject);
  const related = mergeById([
    ...searchRelatedEmailsForAgent({
      messageId,
      query: subjectQuery,
      subject: subjectQuery,
      limit: options.relatedLimit ?? 8
    }),
    ...(senderEmail
      ? searchRelatedEmailsForAgent({
          messageId,
          sender: senderEmail,
          limit: options.relatedLimit ?? 8
        })
      : [])
  ]).slice(0, options.relatedLimit ?? 10);
  const contact = senderEmail
    ? db
        .select()
        .from(contacts)
        .where(and(eq(contacts.accountId, message.accountId), eq(contacts.email, senderEmail)))
        .get()
    : null;
  const threadKey = detail.conversationKey || message.threadId || normalizeSubject(message.subject);
  const legacyThreadKey = message.threadId || normalizeSubject(message.subject);
  const threadSummary = db
    .select()
    .from(threadSummaries)
    .where(and(eq(threadSummaries.accountId, message.accountId), eq(threadSummaries.threadKey, threadKey)))
    .get();
  const threadSummaryFallback =
    threadSummary ||
    (legacyThreadKey !== threadKey
      ? db
          .select()
          .from(threadSummaries)
          .where(
            and(eq(threadSummaries.accountId, message.accountId), eq(threadSummaries.threadKey, legacyThreadKey))
          )
          .get()
      : null);
  const openFollowUps = db
    .select()
    .from(followUpReminders)
    .where(and(eq(followUpReminders.messageId, messageId), eq(followUpReminders.status, 'open')))
    .orderBy(followUpReminders.dueAt)
    .all();
  const openObligations = db
    .select()
    .from(agentObligations)
    .where(and(eq(agentObligations.messageId, messageId), eq(agentObligations.status, 'open')))
    .orderBy(agentObligations.dueAt)
    .all();
  const recentOutcomes = db
    .select()
    .from(outcomeEvents)
    .where(eq(outcomeEvents.messageId, messageId))
    .orderBy(desc(outcomeEvents.createdAt))
    .limit(5)
    .all();
  const recentToolCalls = db
    .select({
      toolName: toolCalls.toolName,
      status: toolCalls.status,
      createdAt: toolCalls.createdAt
    })
    .from(toolCalls)
    .innerJoin(taskRuns, eq(taskRuns.id, toolCalls.taskRunId))
    .where(eq(taskRuns.messageId, messageId))
    .orderBy(desc(toolCalls.createdAt))
    .limit(5)
    .all();
  return {
    message: {
      id: message.id,
      accountId: message.accountId,
      subject: message.subject,
      from: message.from,
      to: message.to,
      cc: message.cc,
      date: message.date,
      folderPath: message.folderPath,
      bodyText: options.includeBody === false ? undefined : message.bodyText
    },
    memoryContext: buildMemoryPromptContext({
      subject: message.subject,
      bodyText: message.bodyText,
      note: options.note || null
    }).text,
    contact,
    threadSummary: threadSummaryFallback,
    relatedEmails: related,
    openFollowUps,
    openObligations,
    recentOutcomes,
    recentToolCalls,
    currentThread: detail.thread?.slice(-5).map((item) => ({
      id: item.id,
      from: item.from,
      date: item.date,
      subject: item.subject,
      snippet: compactText(item.bodyText, 180)
    }))
  };
}

export function contextForPrompt(context: NonNullable<UnifiedAgentContext>) {
  return JSON.stringify(
    {
      contact: context.contact
        ? {
            email: context.contact.email,
            name: context.contact.name,
            source: context.contact.source,
            lastSeenAt: context.contact.lastSeenAt
          }
        : null,
      threadSummary: context.threadSummary
        ? {
            summary: compactText(context.threadSummary.summary, 360),
            nextAction: context.threadSummary.nextAction,
            urgency: context.threadSummary.urgency
          }
        : null,
      relatedEmails: context.relatedEmails.slice(0, 5).map((email) => ({
        id: email.id,
        date: email.date,
        from: email.from,
        subject: compactText(email.subject, 140),
        folderPath: email.folderPath,
        snippet: compactText(email.snippet, 180)
      })),
      openFollowUps: context.openFollowUps.slice(0, 5).map((followUp) => ({
        id: followUp.id,
        dueAt: followUp.dueAt,
        reason: compactText(followUp.reason, 180)
      })),
      openObligations: context.openObligations.slice(0, 6).map((obligation) => ({
        id: obligation.id,
        owner: obligation.owner,
        kind: obligation.kind,
        title: compactText(obligation.title, 160),
        dueAt: obligation.dueAt,
        confidence: obligation.confidence
      })),
      recentOutcomes: context.recentOutcomes.slice(0, 4).map((outcome) => ({
        outcomeType: outcome.outcomeType,
        notes: outcome.notes ? compactText(outcome.notes, 160) : null,
        createdAt: outcome.createdAt
      })),
      recentToolCalls: context.recentToolCalls,
      currentThread: context.currentThread
    },
    null,
    2
  );
}

function compactText(value: string, max: number) {
  const compacted = value.replace(/\s+/g, ' ').trim();
  return compacted.length > max ? `${compacted.slice(0, max - 12)} [truncated]` : compacted;
}

export function extractEmail(value: string) {
  const match = value.match(/([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/i);
  return match?.[1]?.toLowerCase() || null;
}

export function normalizeSubject(subject: string) {
  return subject
    .toLowerCase()
    .replace(/^(re|fwd?):\s*/i, '')
    .trim();
}

function normalizeSubjectForSearch(subject: string) {
  return normalizeSubject(subject)
    .replace(/\[[^\]]+\]/g, ' ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter((token) => token.length > 2)
    .slice(0, 8)
    .join(' ');
}

function mergeById<T extends { id: number }>(rows: T[]) {
  const seen = new Set<number>();
  return rows.filter((row) => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
}
