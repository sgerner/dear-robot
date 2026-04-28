import { relations } from 'drizzle-orm';
import { integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const accounts = sqliteTable('accounts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').notNull(),
  host: text('host').notNull(),
  port: integer('port').notNull(),
  username: text('username').notNull(),
  passwordEncrypted: text('password_encrypted').notNull(),
  smtpHost: text('smtp_host').notNull(),
  smtpPort: integer('smtp_port').notNull(),
  smtpUsername: text('smtp_username').notNull(),
  smtpPasswordEncrypted: text('smtp_password_encrypted').notNull(),
  isEnabled: integer('is_enabled', { mode: 'boolean' }).notNull().default(true),
  lastSyncAt: text('last_sync_at'),
  syncStatus: text('sync_status', { enum: ['idle', 'syncing', 'error', 'disabled'] }).notNull().default('idle'),
  syncError: text('sync_error'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
});

export const folders = sqliteTable(
  'folders',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    accountId: integer('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    path: text('path').notNull(),
    role: text('role'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull()
  },
  (table) => ({
    accountPath: uniqueIndex('folders_account_path_unique').on(table.accountId, table.path)
  })
);

export const messages = sqliteTable(
  'messages',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    accountId: integer('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
    providerMessageId: text('provider_message_id').notNull(),
    threadId: text('thread_id'),
    folderPath: text('folder_path').notNull(),
    subject: text('subject').notNull(),
    from: text('from').notNull(),
    to: text('to').notNull(),
    cc: text('cc'),
    date: text('date').notNull(),
    bodyText: text('body_text').notNull(),
    bodyHtml: text('body_html'),
    isRead: integer('is_read', { mode: 'boolean' }).notNull().default(false),
    isAnswered: integer('is_answered', { mode: 'boolean' }).notNull().default(false),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull()
  },
  (table) => ({
    providerUnique: uniqueIndex('messages_account_provider_unique').on(
      table.accountId,
      table.providerMessageId
    )
  })
);

export const aiSuggestions = sqliteTable('ai_suggestions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  messageId: integer('message_id').notNull().references(() => messages.id, { onDelete: 'cascade' }),
  category: text('category').notNull(),
  confidence: real('confidence').notNull(),
  recommendedAction: text('recommended_action', {
    enum: ['reply', 'forward', 'move_to_folder', 'delete', 'spam', 'delegate', 'archive', 'no_action']
  }).notNull(),
  targetFolder: text('target_folder'),
  draftReply: text('draft_reply'),
  forwardTo: text('forward_to'),
  delegateInstructions: text('delegate_instructions'),
  reasoningSummary: text('reasoning_summary').notNull(),
  riskLevel: text('risk_level', { enum: ['low', 'medium', 'high'] }).notNull(),
  status: text('status', {
    enum: ['pending', 'approved', 'rejected', 'edited', 'executed', 'error']
  }).notNull().default('pending'),
  errorMessage: text('error_message'),
  rawModel: text('raw_model'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
});

export const feedbackLog = sqliteTable('feedback_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  messageId: integer('message_id').notNull().references(() => messages.id, { onDelete: 'cascade' }),
  suggestionId: integer('suggestion_id').references(() => aiSuggestions.id, { onDelete: 'set null' }),
  originalSuggestion: text('original_suggestion').notNull(),
  userCorrection: text('user_correction').notNull(),
  createdAt: text('created_at').notNull()
});

export const webhookSubscriptions = sqliteTable('webhook_subscriptions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  eventType: text('event_type').notNull(),
  targetUrl: text('target_url').notNull(),
  secret: text('secret'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
});

export const executedActions = sqliteTable('executed_actions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  messageId: integer('message_id').notNull().references(() => messages.id, { onDelete: 'cascade' }),
  suggestionId: integer('suggestion_id').notNull().references(() => aiSuggestions.id, { onDelete: 'cascade' }),
  actionType: text('action_type').notNull(),
  status: text('status').notNull(),
  detailsJson: text('details_json').notNull(),
  createdAt: text('created_at').notNull()
});

export const accountRelations = relations(accounts, ({ many }) => ({
  folders: many(folders),
  messages: many(messages)
}));

export const messageRelations = relations(messages, ({ many, one }) => ({
  account: one(accounts, { fields: [messages.accountId], references: [accounts.id] }),
  suggestions: many(aiSuggestions)
}));

export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type AiSuggestion = typeof aiSuggestions.$inferSelect;
