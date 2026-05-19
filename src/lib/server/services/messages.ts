import { and, desc, eq, inArray, like, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, nowIso } from '../db';
import {
  accounts,
  aiSuggestions,
  contacts,
  drafts,
  executedActions,
  feedbackLog,
  folders,
  messageAttachments,
  messages
} from '../db/schema';
import { readAgentInstructions } from '../memory';
import { buildMemoryPromptContext, recordMemoryEvent } from '../memory-learning';
import { generateEmailSuggestion } from '../ai/provider';
import { EmailSuggestionSchema, type EmailSuggestion } from '../ai/schema';
import { providerForAccount } from '../email/provider';
import { signWebhookPayload } from '../security';
import { webhookSubscriptions } from '../db/schema';
import { sanitizeEmailHtml } from '../html';
import { evaluateAttachmentPolicy } from '../attachment-policy';
import { promptHash, recordAiObservation } from '../agent/observability';

export const MessageQuerySchema = z.object({
  q: z.string().optional(),
  view: z.string().optional(),
  accountId: z.coerce.number().optional(),
  folder: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50)
});

export const MessageMoveSchema = z.object({
  folderPath: z.string().min(1)
});

export const MessageReadSchema = z.object({
  read: z.boolean()
});

export const MessageFlagSchema = z.object({
  flagged: z.boolean()
});

export const FolderRoleSchema = z.object({
  role: z
    .enum(['inbox', 'archive', 'spam', 'trash', 'sent', 'drafts', 'newsletters', 'receipts'])
    .nullable()
    .optional()
});

export const BulkMessageActionSchema = z
  .object({
    messageIds: z.array(z.coerce.number().int().positive()).min(1).max(500),
    action: z.enum(['move', 'mark_read', 'mark_unread', 'flag', 'unflag']),
    folderPath: z.string().min(1).optional()
  })
  .superRefine((value, ctx) => {
    if (value.action === 'move' && !value.folderPath) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'folderPath is required when action is move'
      });
    }
  });

export const ComposeSendSchema = z.object({
  accountId: z.coerce.number().int().positive(),
  to: z.string().min(1),
  cc: z.string().nullable().optional(),
  bcc: z.string().nullable().optional(),
  subject: z.string().min(1),
  body: z.string().min(1),
  bodyHtml: z.string().nullable().optional(),
  attachments: z
    .array(
      z.object({
        filename: z.string().min(1),
        contentType: z.string().nullable().optional(),
        contentBase64: z.string().min(1)
      })
    )
    .optional(),
  mode: z.enum(['compose', 'reply', 'reply_all', 'forward']).default('compose'),
  draftId: z.coerce.number().int().positive().nullable().optional(),
  sourceMessageId: z.coerce.number().int().positive().nullable().optional()
});

export const DraftUpsertSchema = z.object({
  id: z.coerce.number().int().positive().nullable().optional(),
  accountId: z.coerce.number().int().positive(),
  mode: z.enum(['compose', 'reply', 'reply_all', 'forward']).default('compose'),
  sourceMessageId: z.coerce.number().int().positive().nullable().optional(),
  to: z.string().default(''),
  cc: z.string().nullable().optional(),
  bcc: z.string().nullable().optional(),
  subject: z.string().default(''),
  bodyText: z.string().default(''),
  bodyHtml: z.string().nullable().optional(),
  attachments: z
    .array(
      z.object({
        filename: z.string().min(1),
        contentType: z.string().nullable().optional(),
        contentBase64: z.string().min(1)
      })
    )
    .default([])
});

export const ContactImportSchema = z.object({
  accountId: z.coerce.number().int().positive().nullable().optional(),
  csv: z.string().min(1)
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

export function listMessages(query: z.infer<typeof MessageQuerySchema>) {
  const where = [];
  if (query.accountId) where.push(eq(messages.accountId, query.accountId));
  if (query.folder) where.push(eq(messages.folderPath, query.folder));
  const ftsQuery = query.q ? toFtsQuery(query.q) : '';
  const likePattern = query.q ? `%${query.q}%` : '';
  if (ftsQuery)
    where.push(
      sql`messages.id IN (SELECT rowid FROM messages_fts WHERE messages_fts MATCH ${ftsQuery})`
    );
  else if (query.q)
    where.push(
      or(
        like(messages.subject, likePattern),
        like(messages.from, likePattern),
        like(messages.to, likePattern),
        like(messages.bodyText, likePattern)
      )
    );
  if (query.view === 'pending') {
    where.push(
      sql`EXISTS (SELECT 1 FROM ai_suggestions s WHERE s.message_id = messages.id AND s.status = 'pending')`
    );
  }
  if (query.view === 'executed') {
    where.push(sql`EXISTS (SELECT 1 FROM executed_actions a WHERE a.message_id = messages.id)`);
  }
  if (query.view === 'starred') where.push(eq(messages.isFlagged, true));
  if (query.view === 'unread') where.push(eq(messages.isRead, false));
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
        isAnswered: messages.isAnswered,
        isFlagged: messages.isFlagged,
        latestSuggestionId: messages.latestSuggestionId,
        category: aiSuggestions.category,
        recommendedAction: aiSuggestions.recommendedAction,
        riskLevel: aiSuggestions.riskLevel,
        suggestionStatus: aiSuggestions.status
      })
      .from(messages)
      .innerJoin(accounts, eq(accounts.id, messages.accountId))
      .leftJoin(aiSuggestions, eq(aiSuggestions.id, messages.latestSuggestionId))
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
    if (query.folder) fallbackWhere.push(eq(messages.folderPath, query.folder));
    fallbackWhere.push(
      or(
        like(messages.subject, likePattern),
        like(messages.from, likePattern),
        like(messages.to, likePattern),
        like(messages.bodyText, likePattern)
      )
    );
    if (query.view === 'pending') {
      fallbackWhere.push(
        sql`EXISTS (SELECT 1 FROM ai_suggestions s WHERE s.message_id = messages.id AND s.status = 'pending')`
      );
    }
    if (query.view === 'executed') {
      fallbackWhere.push(
        sql`EXISTS (SELECT 1 FROM executed_actions a WHERE a.message_id = messages.id)`
      );
    }
    if (query.view === 'starred') fallbackWhere.push(eq(messages.isFlagged, true));
    if (query.view === 'unread') fallbackWhere.push(eq(messages.isRead, false));
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
        isAnswered: messages.isAnswered,
        isFlagged: messages.isFlagged,
        latestSuggestionId: messages.latestSuggestionId,
        category: aiSuggestions.category,
        recommendedAction: aiSuggestions.recommendedAction,
        riskLevel: aiSuggestions.riskLevel,
        suggestionStatus: aiSuggestions.status
      })
      .from(messages)
      .innerJoin(accounts, eq(accounts.id, messages.accountId))
      .leftJoin(aiSuggestions, eq(aiSuggestions.id, messages.latestSuggestionId))
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
  const attachments = db
    .select({
      id: messageAttachments.id,
      messageId: messageAttachments.messageId,
      filename: messageAttachments.filename,
      contentType: messageAttachments.contentType,
      sizeBytes: messageAttachments.sizeBytes,
      contentId: messageAttachments.contentId,
      disposition: messageAttachments.disposition,
      createdAt: messageAttachments.createdAt,
      hasContent: sql<boolean>`${messageAttachments.contentBase64} IS NOT NULL`
    })
    .from(messageAttachments)
    .where(eq(messageAttachments.messageId, id))
    .all();
  const suggestions = db
    .select()
    .from(aiSuggestions)
    .where(eq(aiSuggestions.messageId, id))
    .orderBy(desc(aiSuggestions.createdAt))
    .all();
  const executed = db
    .select()
    .from(executedActions)
    .where(eq(executedActions.messageId, id))
    .orderBy(desc(executedActions.createdAt))
    .all();
  const threadKey = message.threadId || normalizedSubject(message.subject);
  const thread = db
    .select({
      id: messages.id,
      accountId: messages.accountId,
      providerMessageId: messages.providerMessageId,
      threadId: messages.threadId,
      folderPath: messages.folderPath,
      subject: messages.subject,
      from: messages.from,
      to: messages.to,
      date: messages.date,
      bodyText: sql<string>`substr(${messages.bodyText}, 1, 500)`,
      isRead: messages.isRead,
      isAnswered: messages.isAnswered,
      isFlagged: messages.isFlagged
    })
    .from(messages)
    .where(
      and(
        eq(messages.accountId, message.accountId),
        or(
          eq(messages.threadId, threadKey),
          like(messages.subject, `%${normalizedSubject(message.subject)}%`)
        )
      )
    )
    .orderBy(messages.date)
    .limit(50)
    .all();
  return {
    message: {
      ...message,
      safeBodyHtml: sanitizeEmailHtml(message.bodyHtml)
    },
    account,
    attachments,
    suggestion: suggestions[0] ?? null,
    suggestions,
    executed,
    thread
  };
}

function getMessageWithAccount(id: number) {
  return db
    .select({
      message: {
        id: messages.id,
        accountId: messages.accountId,
        providerMessageId: messages.providerMessageId,
        threadId: messages.threadId,
        messageIdHeader: messages.messageIdHeader,
        inReplyTo: messages.inReplyTo,
        references: messages.references,
        folderPath: messages.folderPath,
        subject: messages.subject,
        from: messages.from,
        to: messages.to,
        cc: messages.cc,
        bcc: messages.bcc,
        date: messages.date,
        bodyText: messages.bodyText,
        bodyHtml: messages.bodyHtml,
        latestSuggestionId: messages.latestSuggestionId,
        isRead: messages.isRead,
        isAnswered: messages.isAnswered,
        isFlagged: messages.isFlagged,
        createdAt: messages.createdAt,
        updatedAt: messages.updatedAt
      },
      account: accounts
    })
    .from(messages)
    .innerJoin(accounts, eq(accounts.id, messages.accountId))
    .where(eq(messages.id, id))
    .get();
}

export function getAttachment(messageId: number, attachmentId: number) {
  return db
    .select()
    .from(messageAttachments)
    .where(
      and(eq(messageAttachments.id, attachmentId), eq(messageAttachments.messageId, messageId))
    )
    .get();
}

export function listAttachments(messageId: number) {
  return db
    .select()
    .from(messageAttachments)
    .where(eq(messageAttachments.messageId, messageId))
    .all()
    .map((attachment) => ({
      ...attachment,
      hasContent: Boolean(attachment.contentBase64)
    }));
}

export function listFoldersWithCounts(accountId?: number) {
  const where = accountId ? eq(folders.accountId, accountId) : undefined;
  const folderRows = db
    .select({
      id: folders.id,
      accountId: folders.accountId,
      accountEmail: accounts.email,
      name: folders.name,
      path: folders.path,
      role: folders.role,
      total: sql<number>`count(${messages.id})`,
      unread: sql<number>`coalesce(sum(case when ${messages.isRead} = 0 then 1 else 0 end), 0)`
    })
    .from(folders)
    .innerJoin(accounts, eq(accounts.id, folders.accountId))
    .leftJoin(
      messages,
      and(eq(messages.accountId, folders.accountId), eq(messages.folderPath, folders.path))
    )
    .where(where)
    .groupBy(
      folders.id,
      folders.accountId,
      accounts.email,
      folders.name,
      folders.path,
      folders.role
    )
    .orderBy(accounts.email, folders.path)
    .all();
  return folderRows;
}

export function listContacts(query = '', limit = 50) {
  const pattern = `%${query}%`;
  return db
    .select()
    .from(contacts)
    .where(query ? or(like(contacts.email, pattern), like(contacts.name, pattern)) : undefined)
    .orderBy(desc(contacts.lastSeenAt))
    .limit(limit)
    .all();
}

export function exportContactsCsv(accountId?: number) {
  const rows = db
    .select()
    .from(contacts)
    .where(accountId ? eq(contacts.accountId, accountId) : undefined)
    .orderBy(contacts.accountId, contacts.email)
    .all();
  const header = 'account_id,email,name,source,last_seen_at';
  const body = rows
    .map((row) =>
      [row.accountId ?? '', row.email, row.name ?? '', row.source, row.lastSeenAt]
        .map(csvEscape)
        .join(',')
    )
    .join('\n');
  return `${header}\n${body}\n`;
}

export function importContactsCsv(input: z.infer<typeof ContactImportSchema>) {
  const lines = input.csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return { imported: 0 };
  const rows = lines[0].toLowerCase().includes('email') ? lines.slice(1) : lines;
  let imported = 0;
  const now = nowIso();
  for (const row of rows) {
    const columns = splitCsvLine(row);
    const hasAccountPrefix = Boolean(columns[0] && !columns[0].includes('@'));
    const accountIdRaw = hasAccountPrefix ? columns[0] : undefined;
    const emailRaw = hasAccountPrefix ? columns[1] : columns[0];
    const nameRaw = hasAccountPrefix ? columns[2] : columns[1];
    const sourceRaw = hasAccountPrefix ? columns[3] : columns[2];
    const email = (emailRaw || '').trim().toLowerCase();
    if (!email.includes('@')) continue;
    const targetAccountId = input.accountId ?? parseNullableInt(accountIdRaw);
    const name = nameRaw?.trim() || null;
    db.insert(contacts)
      .values({
        accountId: targetAccountId,
        email,
        name,
        source: sourceRaw?.trim() || 'import',
        lastSeenAt: now,
        createdAt: now,
        updatedAt: now
      })
      .onConflictDoUpdate({
        target: [contacts.accountId, contacts.email],
        set: { name, source: sourceRaw?.trim() || 'import', lastSeenAt: now, updatedAt: now }
      })
      .run();
    imported += 1;
  }
  return { imported };
}

export function listDrafts(accountId?: number) {
  return db
    .select()
    .from(drafts)
    .where(accountId ? eq(drafts.accountId, accountId) : undefined)
    .orderBy(desc(drafts.updatedAt))
    .all()
    .map((draft) => ({
      ...draft,
      attachments: parseAttachments(draft.attachmentsJson)
    }));
}

export function upsertDraft(input: z.infer<typeof DraftUpsertSchema>) {
  const now = nowIso();
  const attachmentsJson = JSON.stringify(input.attachments || []);
  if (input.id) {
    return db
      .update(drafts)
      .set({
        accountId: input.accountId,
        mode: input.mode,
        sourceMessageId: input.sourceMessageId ?? null,
        to: input.to,
        cc: input.cc ?? null,
        bcc: input.bcc ?? null,
        subject: input.subject,
        bodyText: input.bodyText,
        bodyHtml: input.bodyHtml ?? null,
        attachmentsJson,
        status: 'draft',
        updatedAt: now
      })
      .where(eq(drafts.id, input.id))
      .returning()
      .get();
  }
  return db
    .insert(drafts)
    .values({
      accountId: input.accountId,
      mode: input.mode,
      sourceMessageId: input.sourceMessageId ?? null,
      to: input.to,
      cc: input.cc ?? null,
      bcc: input.bcc ?? null,
      subject: input.subject,
      bodyText: input.bodyText,
      bodyHtml: input.bodyHtml ?? null,
      attachmentsJson,
      status: 'draft',
      createdAt: now,
      updatedAt: now
    })
    .returning()
    .get();
}

export function deleteDraft(id: number) {
  return db.delete(drafts).where(eq(drafts.id, id)).returning().get();
}

export async function moveMessage(id: number, folderPath: string) {
  const context = getMessageWithAccount(id);
  if (!context?.message || !context.account) throw new Error('Message not found');
  const provider = providerForAccount(context.account);
  await provider.move(context.account, context.message, folderPath);
  return db
    .update(messages)
    .set({ folderPath, updatedAt: nowIso() })
    .where(eq(messages.id, id))
    .returning()
    .get();
}

export async function bulkMessageAction(input: z.infer<typeof BulkMessageActionSchema>) {
  const rows = db
    .select({
      message: {
        id: messages.id,
        accountId: messages.accountId,
        providerMessageId: messages.providerMessageId,
        threadId: messages.threadId,
        folderPath: messages.folderPath,
        subject: messages.subject,
        from: messages.from,
        to: messages.to,
        date: messages.date,
        isRead: messages.isRead,
        isFlagged: messages.isFlagged,
        isAnswered: messages.isAnswered
      },
      account: accounts
    })
    .from(messages)
    .innerJoin(accounts, eq(accounts.id, messages.accountId))
    .where(inArray(messages.id, input.messageIds))
    .all();
  let processed = 0;
  for (const row of rows) {
    const provider = providerForAccount(row.account);
    const msgContext = row.message as any;
    if (input.action === 'move') {
      const folderPath = input.folderPath || 'INBOX';
      await provider.move(row.account, msgContext, folderPath);
      db.update(messages)
        .set({ folderPath, updatedAt: nowIso() })
        .where(eq(messages.id, row.message.id))
        .run();
    }
    if (input.action === 'mark_read' || input.action === 'mark_unread') {
      const read = input.action === 'mark_read';
      await provider.markRead(row.account, msgContext, read);
      db.update(messages)
        .set({ isRead: read, updatedAt: nowIso() })
        .where(eq(messages.id, row.message.id))
        .run();
    }
    if (input.action === 'flag' || input.action === 'unflag') {
      const flagged = input.action === 'flag';
      await provider.setFlagged(row.account, msgContext, flagged);
      db.update(messages)
        .set({ isFlagged: flagged, updatedAt: nowIso() })
        .where(eq(messages.id, row.message.id))
        .run();
    }
    processed += 1;
  }
  return { processed, requested: input.messageIds.length };
}

export async function setMessageRead(id: number, read: boolean) {
  const context = getMessageWithAccount(id);
  if (!context?.message || !context.account) throw new Error('Message not found');
  const provider = providerForAccount(context.account);
  await provider.markRead(context.account, context.message, read);
  return db
    .update(messages)
    .set({ isRead: read, updatedAt: nowIso() })
    .where(eq(messages.id, id))
    .returning()
    .get();
}

export async function setMessageFlagged(id: number, flagged: boolean) {
  const context = getMessageWithAccount(id);
  if (!context?.message || !context.account) throw new Error('Message not found');
  const provider = providerForAccount(context.account);
  await provider.setFlagged(context.account, context.message, flagged);
  return db
    .update(messages)
    .set({ isFlagged: flagged, updatedAt: nowIso() })
    .where(eq(messages.id, id))
    .returning()
    .get();
}

export function updateFolderRole(id: number, role: z.infer<typeof FolderRoleSchema>['role']) {
  return db
    .update(folders)
    .set({ role: role || null, updatedAt: nowIso() })
    .where(eq(folders.id, id))
    .returning()
    .get();
}

export async function sendComposedMessage(input: z.infer<typeof ComposeSendSchema>) {
  for (const attachment of input.attachments || []) {
    const policy = evaluateAttachmentPolicy({
      filename: attachment.filename,
      contentType: attachment.contentType || null,
      sizeBytes: Buffer.byteLength(attachment.contentBase64, 'base64')
    });
    if (!policy.allowed) throw new Error(policy.reason || 'Attachment blocked by policy');
  }
  const account = db.select().from(accounts).where(eq(accounts.id, input.accountId)).get();
  if (!account) throw new Error('Account not found');
  const source = input.sourceMessageId
    ? db.select().from(messages).where(eq(messages.id, input.sourceMessageId)).get()
    : null;
  const provider = providerForAccount(account);
  const sent = await provider.send(account, {
    to: input.to,
    cc: input.cc || null,
    bcc: input.bcc || null,
    subject: input.subject,
    text: input.body,
    html: input.bodyHtml || null,
    inReplyTo: source?.messageIdHeader || source?.threadId || null,
    references: source?.references || source?.messageIdHeader || null,
    attachments: input.attachments || []
  });
  if (source && ['reply', 'reply_all'].includes(input.mode)) {
    await provider.markAnswered(account, source);
    db.update(messages)
      .set({ isAnswered: true, updatedAt: nowIso() })
      .where(eq(messages.id, source.id))
      .run();
  }
  const now = nowIso();
  upsertContactsFromAddressList(account.id, [input.to, input.cc || '', input.bcc || ''], now);
  if (input.draftId) {
    db.update(drafts)
      .set({ status: 'sent', updatedAt: now })
      .where(eq(drafts.id, input.draftId))
      .run();
  }
  return {
    ok: true,
    messageId: sent.messageId,
    sourceMessageId: source?.id ?? null,
    draftId: input.draftId ?? null
  };
}

export async function suggestForMessage(
  id: number,
  options: { note?: string | null; existing?: EmailSuggestion | null } = {}
) {
  const context = getMessageWithAccount(id);
  if (!context?.message || !context.account) throw new Error('Message not found');
  const message = context.message;
  const folderRows = db
    .select()
    .from(folders)
    .where(eq(folders.accountId, message.accountId))
    .all();
  const input = {
    agentInstructions: readAgentInstructions(),
    memoryContext: buildMemoryPromptContext({
      subject: message.subject,
      bodyText: message.bodyText,
      note: options.note || null
    }).text,
    subject: message.subject,
    sender: message.from,
    recipients: message.to,
    cc: message.cc,
    date: message.date,
    bodyText: message.bodyText,
    availableFolders: folderRows.map((folder) => folder.path),
    existingSuggestion: options.existing ?? null,
    regenerationNote: options.note ?? null
  };
  const started = Date.now();
  const result = await generateEmailSuggestion(input);
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
  db.update(messages)
    .set({ latestSuggestionId: saved.id, updatedAt: nowIso() })
    .where(eq(messages.id, id))
    .run();
  recordAiObservation({
    messageId: id,
    suggestionId: saved.id,
    operation: options.existing ? 'regenerate_suggestion' : 'generate_suggestion',
    provider: result.provider,
    model: result.model,
    status: result.errorMessage ? 'error' : 'ok',
    latencyMs: Date.now() - started,
    promptHash: promptHash(input),
    estimatedCostCents: estimateSuggestionCostCents(message.bodyText.length),
    errorMessage: result.errorMessage
  });
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
  recordMemoryEvent({
    eventType: 'suggestion_regenerate',
    messageId,
    suggestionId: saved.id,
    beforeText: JSON.stringify(original),
    afterText: saved.draftReply || saved.reasoningSummary,
    note: note || null
  });
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
  recordMemoryEvent({
    eventType: 'suggestion_edit',
    messageId: existing.messageId,
    suggestionId: updated.id,
    beforeText: existing.draftReply || existing.reasoningSummary,
    afterText: updated.draftReply || updated.reasoningSummary,
    note: null
  });
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
  const existing = db
    .select()
    .from(executedActions)
    .where(eq(executedActions.suggestionId, id))
    .get();
  if (existing?.status === 'executed') return existing;
  const message = db.select().from(messages).where(eq(messages.id, suggestion.messageId)).get();
  if (!message) throw new Error('Message not found');
  const account = db.select().from(accounts).where(eq(accounts.id, message.accountId)).get();
  if (!account) throw new Error('Account not found');
  const provider = providerForAccount(account);
  const now = nowIso();
  let details: unknown;
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
    db.update(messages)
      .set({ isAnswered: true, updatedAt: now })
      .where(eq(messages.id, message.id))
      .run();
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
      db.update(messages)
        .set({ folderPath: target, updatedAt: now })
        .where(eq(messages.id, message.id))
        .run();
      details = { targetFolder: target };
    } else {
      details = { handledWithoutMove: true };
    }
  } else if (action === 'delegate') {
    details = await dispatchDelegateWebhooks(
      message.id,
      suggestion.id,
      suggestion.delegateInstructions || ''
    );
  } else {
    details = { handled: true };
  }
  db.update(aiSuggestions)
    .set({ status: 'executed', updatedAt: now })
    .where(eq(aiSuggestions.id, id))
    .run();
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
    folderRows.find((folder) =>
      names.some((name) => folder.path.toLowerCase() === name.toLowerCase())
    )?.path;
  const findByRole = (role: string) =>
    folderRows.find((folder) => folder.role?.toLowerCase() === role)?.path;
  if (suggestion.recommendedAction === 'move_to_folder')
    return suggestion.targetFolder || undefined;
  if (suggestion.recommendedAction === 'archive') return findByRole('archive') || find('Archive');
  if (suggestion.recommendedAction === 'spam')
    return findByRole('spam') || find('Spam', 'Junk', 'Spam Review');
  if (suggestion.recommendedAction === 'delete')
    return findByRole('trash') || find('Trash', 'Deleted Items');
  return undefined;
}

async function dispatchDelegateWebhooks(
  messageId: number,
  suggestionId: number,
  instructions: string
) {
  const subscriptions = db
    .select()
    .from(webhookSubscriptions)
    .where(eq(webhookSubscriptions.eventType, 'delegate'))
    .all();
  const payload = JSON.stringify({ event: 'delegate', messageId, suggestionId, instructions });
  const results = [];
  for (const subscription of subscriptions) {
    try {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (subscription.secret)
        headers['x-dear-robot-signature'] = signWebhookPayload(payload, subscription.secret);
      const response = await fetch(subscription.targetUrl, {
        method: 'POST',
        headers,
        body: payload
      });
      results.push({ id: subscription.id, ok: response.ok, status: response.status });
    } catch (error) {
      results.push({
        id: subscription.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  return { webhookResults: results };
}

function toFtsQuery(input: string) {
  const tokens = input
    .split(/\s+/)
    .map((token) =>
      token
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9@._-]/g, '')
    )
    .filter(Boolean);
  if (!tokens.length) return '';
  return tokens.map((token) => `${token}*`).join(' AND ');
}

function normalizedSubject(subject: string) {
  return subject
    .toLowerCase()
    .replace(/^(re|fwd?):\s*/i, '')
    .trim();
}

function upsertContactsFromAddressList(accountId: number, values: string[], seenAt: string) {
  for (const value of values) {
    for (const contact of extractContacts(value)) {
      db.insert(contacts)
        .values({
          accountId,
          email: contact.email,
          name: contact.name,
          source: 'manual',
          lastSeenAt: seenAt,
          createdAt: seenAt,
          updatedAt: seenAt
        })
        .onConflictDoUpdate({
          target: [contacts.accountId, contacts.email],
          set: { name: contact.name, source: 'manual', lastSeenAt: seenAt, updatedAt: seenAt }
        })
        .run();
    }
  }
}

function extractContacts(value: string) {
  return value
    .split(',')
    .map((part) => {
      const match = part.trim().match(/^(.*?)<([^>]+)>$/);
      if (match)
        return {
          name: match[1].trim().replace(/^"|"$/g, '') || null,
          email: match[2].trim().toLowerCase()
        };
      const email = part.trim().toLowerCase();
      return email.includes('@') ? { name: null, email } : null;
    })
    .filter((contact): contact is { name: string | null; email: string } =>
      Boolean(contact?.email)
    );
}

function parseAttachments(value: string | null) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function csvEscape(value: string | number) {
  const raw = String(value ?? '');
  if (!raw.includes('"') && !raw.includes(',') && !raw.includes('\n')) return raw;
  return `"${raw.replace(/"/g, '""')}"`;
}

function splitCsvLine(line: string) {
  const out: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (char === ',' && !quoted) {
      out.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  out.push(current);
  return out;
}

function estimateSuggestionCostCents(bodyLength: number) {
  return Math.max(0.001, Math.round((bodyLength / 4000) * 10) / 100);
}

function parseNullableInt(value: string | undefined) {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
