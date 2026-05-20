import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db';
import {
  agentActionQueue,
  aiSuggestions,
  folders,
  followUpReminders,
  messages,
  threadSummaries
} from '../db/schema';
import { listOpenObligations, scanRecentMessagesForObligations } from './obligations';

export function buildDailyBriefing(options: { refreshObligations?: boolean } = {}) {
  const refresh = options.refreshObligations ? scanRecentMessagesForObligations(50) : null;
  const pendingApprovals = db
    .select({
      id: agentActionQueue.id,
      messageId: agentActionQueue.messageId,
      actionType: agentActionQueue.actionType,
      riskLevel: agentActionQueue.riskLevel,
      title: agentActionQueue.title,
      approvalReason: agentActionQueue.approvalReason,
      createdAt: agentActionQueue.createdAt,
      subject: messages.subject,
      sender: messages.from
    })
    .from(agentActionQueue)
    .innerJoin(messages, eq(messages.id, agentActionQueue.messageId))
    .where(inArray(agentActionQueue.status, ['proposed', 'approved', 'failed']))
    .orderBy(desc(agentActionQueue.createdAt))
    .limit(20)
    .all();
  const dueFollowUps = db
    .select({
      id: followUpReminders.id,
      messageId: followUpReminders.messageId,
      dueAt: followUpReminders.dueAt,
      reason: followUpReminders.reason,
      subject: messages.subject,
      sender: messages.from
    })
    .from(followUpReminders)
    .innerJoin(messages, eq(messages.id, followUpReminders.messageId))
    .where(eq(followUpReminders.status, 'open'))
    .orderBy(followUpReminders.dueAt)
    .limit(20)
    .all();
  const importantUnread = db
    .select({
      id: messages.id,
      subject: messages.subject,
      sender: messages.from,
      date: messages.date,
      snippet: sql<string>`substr(${messages.bodyText}, 1, 220)`,
      riskLevel: aiSuggestions.riskLevel,
      recommendedAction: aiSuggestions.recommendedAction
    })
    .from(messages)
    .innerJoin(folders, and(eq(folders.accountId, messages.accountId), eq(folders.path, messages.folderPath)))
    .leftJoin(aiSuggestions, eq(aiSuggestions.id, messages.latestSuggestionId))
    .where(
      and(
        eq(folders.role, 'inbox'),
        eq(messages.isRead, false),
        sql`(${aiSuggestions.riskLevel} IN ('medium', 'high') OR ${messages.isFlagged} = 1 OR ${messages.bodyText} LIKE '%urgent%' OR ${messages.bodyText} LIKE '%deadline%')`
      )
    )
    .orderBy(desc(messages.date))
    .limit(20)
    .all();
  const threadIntelligence = db
    .select()
    .from(threadSummaries)
    .orderBy(desc(threadSummaries.updatedAt))
    .limit(12)
    .all();
  const obligations = listOpenObligations(40);
  return {
    generatedAt: new Date().toISOString(),
    refresh,
    stats: {
      pendingApprovals: pendingApprovals.length,
      dueFollowUps: dueFollowUps.length,
      openObligations: obligations.length,
      importantUnread: importantUnread.length
    },
    pendingApprovals,
    dueFollowUps,
    obligations,
    importantUnread,
    threadIntelligence,
    recommendedFocus: recommendFocus({
      pendingApprovals: pendingApprovals.length,
      dueFollowUps: dueFollowUps.length,
      obligations: obligations.length,
      importantUnread: importantUnread.length
    })
  };
}

function recommendFocus(stats: {
  pendingApprovals: number;
  dueFollowUps: number;
  obligations: number;
  importantUnread: number;
}) {
  if (stats.importantUnread) return 'Review important unread messages first.';
  if (stats.dueFollowUps) return 'Clear due follow-ups.';
  if (stats.pendingApprovals) return 'Approve or reject pending agent actions.';
  if (stats.obligations) return 'Review open commitments.';
  return 'Inbox is in a low-pressure state.';
}
