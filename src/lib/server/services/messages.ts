import { and, desc, eq, like, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, nowIso } from '../db';
import { accounts, aiSuggestions, executedActions, feedbackLog, folders, messages } from '../db/schema';
import { readAgentInstructions } from '../memory';
import { generateEmailSuggestion } from '../ai/provider';
import { EmailSuggestionSchema, type EmailSuggestion } from '../ai/schema';
import { providerForAccount } from '../email/provider';
import { signWebhookPayload } from '../security';
import { webhookSubscriptions } from '../db/schema';
import { sanitizeEmailHtml } from '../html';

export const MessageQuerySchema = z.object({
  q: z.string().optional(),
  view: z.string().optional(),
  accountId: z.coerce.number().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50)
});

export const SuggestionEditSchema = z.object({
  category: z.string().min(1).optional(),
  confidence: z.number().min(0).max(1).optional(),
  recommended_action: EmailSuggestionSchema.shape.recommended_action.optional(),
  target_folder: z.string().nullable().optional(),
  draft_reply: z.string().nullable().optional(),
  forward_to: z.string().nullable().optional(),
  delegate_instructions: z.string().nullable().optional(),
  reasoning_summary: z.string().min(1).optional(),
  risk_level: EmailSuggestionSchema.shape.risk_level.optional()
});

export const RegenerateSchema = z.object({
  note: z.string().max(1000).nullable().optional()
});

function latestSuggestionSubquery() {
  return sql<number>`(
    SELECT id FROM ai_suggestions
    WHERE ai_suggestions.message_id = messages.id
    ORDER BY datetime(ai_suggestions.created_at) DESC
    LIMIT 1
  )`;
}

export function listMessages(query: z.infer<typeof MessageQuerySchema>) {
  const where = [];
  if (query.accountId) where.push(eq(messages.accountId, query.accountId));
  const ftsQuery = query.q ? toFtsQuery(query.q) : '';
  const likePattern = query.q ? `%${query.q}%` : '';
  if (ftsQuery) where.push(sql`messages.id IN (SELECT rowid FROM messages_fts WHERE messages_fts MATCH ${ftsQuery})`);
  else if (query.q) where.push(or(like(messages.subject, likePattern), like(messages.from, likePattern), like(messages.to, likePattern), like(messages.bodyText, likePattern)));
  if (query.view === 'pending') {
    where.push(sql`EXISTS (SELECT 1 FROM ai_suggestions s WHERE s.message_id = messages.id AND s.status = 'pending')`);
  }
  if (query.view === 'executed') {
    where.push(sql`EXISTS (SELECT 1 FROM executed_actions a WHERE a.message_id = messages.id)`);
  }
  try {
    const rows = db
      .select({
        id: messages.id,
        accountId: messages.accountId,
        accountEmail: accounts.email,
        folderPath: messages.folderPath,
        subject: messages.subject,
        from: messages.from,
        to: messages.to,
        date: messages.date,
        snippet: sql<string>`substr(${messages.bodyText}, 1, 180)`,
        isRead: messages.isRead,
        latestSuggestionId: latestSuggestionSubquery(),
        category: aiSuggestions.category,
        recommendedAction: aiSuggestions.recommendedAction,
        riskLevel: aiSuggestions.riskLevel,
        suggestionStatus: aiSuggestions.status
      })
      .from(messages)
      .innerJoin(accounts, eq(accounts.id, messages.accountId))
      .leftJoin(aiSuggestions, eq(aiSuggestions.id, latestSuggestionSubquery()))
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(messages.date))
      .limit(query.limit)
      .all();
    return rows;
  } catch (error) {
    if (!query.q) throw error;
    // FTS query syntax can still fail on malformed input; fall back to LIKE search.
    const fallbackWhere = [];
    if (query.accountId) fallbackWhere.push(eq(messages.accountId, query.accountId));
    fallbackWhere.push(or(like(messages.subject, likePattern), like(messages.from, likePattern), like(messages.to, likePattern), like(messages.bodyText, likePattern)));
    if (query.view === 'pending') {
      fallbackWhere.push(sql`EXISTS (SELECT 1 FROM ai_suggestions s WHERE s.message_id = messages.id AND s.status = 'pending')`);
    }
    if (query.view === 'executed') {
      fallbackWhere.push(sql`EXISTS (SELECT 1 FROM executed_actions a WHERE a.message_id = messages.id)`);
    }
    return db
      .select({
        id: messages.id,
        accountId: messages.accountId,
        accountEmail: accounts.email,
        folderPath: messages.folderPath,
        subject: messages.subject,
        from: messages.from,
        to: messages.to,
        date: messages.date,
        snippet: sql<string>`substr(${messages.bodyText}, 1, 180)`,
        isRead: messages.isRead,
        latestSuggestionId: latestSuggestionSubquery(),
        category: aiSuggestions.category,
        recommendedAction: aiSuggestions.recommendedAction,
        riskLevel: aiSuggestions.riskLevel,
        suggestionStatus: aiSuggestions.status
      })
      .from(messages)
      .innerJoin(accounts, eq(accounts.id, messages.accountId))
      .leftJoin(aiSuggestions, eq(aiSuggestions.id, latestSuggestionSubquery()))
      .where(and(...fallbackWhere))
      .orderBy(desc(messages.date))
      .limit(query.limit)
      .all();
  }
}

export function getMessageDetail(id: number) {
  const message = db.select().from(messages).where(eq(messages.id, id)).get();
  if (!message) return null;
  const account = db.select().from(accounts).where(eq(accounts.id, message.accountId)).get();
  const suggestions = db
    .select()
    .from(aiSuggestions)
    .where(eq(aiSuggestions.messageId, id))
    .orderBy(desc(aiSuggestions.createdAt))
    .all();
  const executed = db.select().from(executedActions).where(eq(executedActions.messageId, id)).orderBy(desc(executedActions.createdAt)).all();
  return {
    message: {
      ...message,
      safeBodyHtml: sanitizeEmailHtml(message.bodyHtml)
    },
    account,
    suggestion: suggestions[0] ?? null,
    suggestions,
    executed
  };
}

export async function suggestForMessage(id: number, options: { note?: string | null; existing?: EmailSuggestion | null } = {}) {
  const detail = getMessageDetail(id);
  if (!detail?.message || !detail.account) throw new Error('Message not found');
  const folderRows = db.select().from(folders).where(eq(folders.accountId, detail.message.accountId)).all();
  const result = await generateEmailSuggestion({
    agentInstructions: readAgentInstructions(),
    subject: detail.message.subject,
    sender: detail.message.from,
    recipients: detail.message.to,
    cc: detail.message.cc,
    date: detail.message.date,
    bodyText: detail.message.bodyText,
    availableFolders: folderRows.map((folder) => folder.path),
    existingSuggestion: options.existing ?? null,
    regenerationNote: options.note ?? null
  });
  const now = nowIso();
  const saved = db
    .insert(aiSuggestions)
    .values({
      messageId: id,
      category: result.suggestion.category,
      confidence: result.suggestion.confidence,
      recommendedAction: result.suggestion.recommended_action,
      targetFolder: result.suggestion.target_folder,
      draftReply: result.suggestion.draft_reply,
      forwardTo: result.suggestion.forward_to,
      delegateInstructions: result.suggestion.delegate_instructions,
      reasoningSummary: result.suggestion.reasoning_summary,
      riskLevel: result.suggestion.risk_level,
      status: result.errorMessage ? 'error' : 'pending',
      errorMessage: result.errorMessage,
      rawModel: result.rawModel,
      createdAt: now,
      updatedAt: now
    })
    .returning()
    .get();
  return saved;
}

export async function regenerateSuggestion(messageId: number, note?: string | null) {
  const detail = getMessageDetail(messageId);
  if (!detail?.suggestion) return suggestForMessage(messageId, { note });
  const original = {
    category: detail.suggestion.category,
    confidence: detail.suggestion.confidence,
    recommended_action: detail.suggestion.recommendedAction,
    target_folder: detail.suggestion.targetFolder,
    draft_reply: detail.suggestion.draftReply,
    forward_to: detail.suggestion.forwardTo,
    delegate_instructions: detail.suggestion.delegateInstructions,
    reasoning_summary: detail.suggestion.reasoningSummary,
    risk_level: detail.suggestion.riskLevel
  } satisfies EmailSuggestion;
  const saved = await suggestForMessage(messageId, { note, existing: original });
  db.insert(feedbackLog)
    .values({
      messageId,
      suggestionId: saved.id,
      originalSuggestion: JSON.stringify(original),
      userCorrection: note || 'Regenerated by user',
      createdAt: nowIso()
    })
    .run();
  return saved;
}

export function editSuggestion(id: number, input: z.infer<typeof SuggestionEditSchema>) {
  const existing = db.select().from(aiSuggestions).where(eq(aiSuggestions.id, id)).get();
  if (!existing) return null;
  const updated = db
    .update(aiSuggestions)
    .set({
      category: input.category ?? existing.category,
      confidence: input.confidence ?? existing.confidence,
      recommendedAction: input.recommended_action ?? existing.recommendedAction,
      targetFolder: input.target_folder ?? existing.targetFolder,
      draftReply: input.draft_reply ?? existing.draftReply,
      forwardTo: input.forward_to ?? existing.forwardTo,
      delegateInstructions: input.delegate_instructions ?? existing.delegateInstructions,
      reasoningSummary: input.reasoning_summary ?? existing.reasoningSummary,
      riskLevel: input.risk_level ?? existing.riskLevel,
      status: 'edited',
      updatedAt: nowIso()
    })
    .where(eq(aiSuggestions.id, id))
    .returning()
    .get();
  return updated;
}

export function rejectSuggestion(id: number) {
  return db
    .update(aiSuggestions)
    .set({ status: 'rejected', updatedAt: nowIso() })
    .where(eq(aiSuggestions.id, id))
    .returning()
    .get();
}

export async function executeSuggestion(id: number) {
  const suggestion = db.select().from(aiSuggestions).where(eq(aiSuggestions.id, id)).get();
  if (!suggestion) throw new Error('Suggestion not found');
  const existing = db.select().from(executedActions).where(eq(executedActions.suggestionId, id)).get();
  if (existing?.status === 'executed') return existing;
  const message = db.select().from(messages).where(eq(messages.id, suggestion.messageId)).get();
  if (!message) throw new Error('Message not found');
  const account = db.select().from(accounts).where(eq(accounts.id, message.accountId)).get();
  if (!account) throw new Error('Account not found');
  const provider = providerForAccount(account);
  const now = nowIso();
  let details: Record<string, unknown> = {};
  const action = suggestion.recommendedAction;
  if (action === 'reply') {
    if (!suggestion.draftReply) throw new Error('Reply action requires draft_reply');
    const sent = await provider.send(account, {
      to: message.from,
      subject: `Re: ${message.subject}`,
      text: suggestion.draftReply,
      inReplyTo: message.threadId
    });
    await provider.markAnswered(account, message);
    db.update(messages).set({ isAnswered: true, updatedAt: now }).where(eq(messages.id, message.id)).run();
    details = sent;
  } else if (action === 'forward') {
    if (!suggestion.forwardTo) throw new Error('Forward action requires forward_to');
    const sent = await provider.send(account, {
      to: suggestion.forwardTo,
      subject: `Fwd: ${message.subject}`,
      text: `${suggestion.draftReply || ''}\n\n--- Forwarded message ---\n${message.bodyText}`
    });
    details = sent;
  } else if (['move_to_folder', 'archive', 'spam', 'delete'].includes(action)) {
    const target = resolveTargetFolder(message.accountId, suggestion);
    if (target) {
      await provider.move(account, message, target);
      db.update(messages).set({ folderPath: target, updatedAt: now }).where(eq(messages.id, message.id)).run();
      details = { targetFolder: target };
    } else {
      details = { handledWithoutMove: true };
    }
  } else if (action === 'delegate') {
    details = await dispatchDelegateWebhooks(message.id, suggestion.id, suggestion.delegateInstructions || '');
  } else {
    details = { handled: true };
  }
  db.update(aiSuggestions).set({ status: 'executed', updatedAt: now }).where(eq(aiSuggestions.id, id)).run();
  return db
    .insert(executedActions)
    .values({
      messageId: message.id,
      suggestionId: suggestion.id,
      actionType: action,
      status: 'executed',
      detailsJson: JSON.stringify(details),
      createdAt: now
    })
    .returning()
    .get();
}

function resolveTargetFolder(accountId: number, suggestion: typeof aiSuggestions.$inferSelect) {
  const folderRows = db.select().from(folders).where(eq(folders.accountId, accountId)).all();
  const find = (...names: string[]) =>
    folderRows.find((folder) => names.some((name) => folder.path.toLowerCase() === name.toLowerCase()))?.path;
  if (suggestion.recommendedAction === 'move_to_folder') return suggestion.targetFolder || undefined;
  if (suggestion.recommendedAction === 'archive') return find('Archive');
  if (suggestion.recommendedAction === 'spam') return find('Spam', 'Junk', 'Spam Review');
  if (suggestion.recommendedAction === 'delete') return find('Trash', 'Deleted Items');
  return undefined;
}

async function dispatchDelegateWebhooks(messageId: number, suggestionId: number, instructions: string) {
  const subscriptions = db.select().from(webhookSubscriptions).where(eq(webhookSubscriptions.eventType, 'delegate')).all();
  const payload = JSON.stringify({ event: 'delegate', messageId, suggestionId, instructions });
  const results = [];
  for (const subscription of subscriptions) {
    try {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (subscription.secret) headers['x-triage-signature'] = signWebhookPayload(payload, subscription.secret);
      const response = await fetch(subscription.targetUrl, { method: 'POST', headers, body: payload });
      results.push({ id: subscription.id, ok: response.ok, status: response.status });
    } catch (error) {
      results.push({ id: subscription.id, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { webhookResults: results };
}

function toFtsQuery(input: string) {
  const tokens = input
    .split(/\s+/)
    .map((token) => token.trim().toLowerCase().replace(/[^a-z0-9@._-]/g, ''))
    .filter(Boolean);
  if (!tokens.length) return '';
  return tokens.map((token) => `${token}*`).join(' AND ');
}
