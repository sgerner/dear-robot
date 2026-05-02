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
  authType: text('auth_type', { enum: ['password', 'oauth_gmail'] })
    .notNull()
    .default('password'),
  oauthProvider: text('oauth_provider'),
  oauthAccessTokenEncrypted: text('oauth_access_token_encrypted'),
  oauthRefreshTokenEncrypted: text('oauth_refresh_token_encrypted'),
  oauthAccessTokenExpiresAt: text('oauth_access_token_expires_at'),
  isEnabled: integer('is_enabled', { mode: 'boolean' }).notNull().default(true),
  lastSyncAt: text('last_sync_at'),
  syncStatus: text('sync_status', { enum: ['idle', 'syncing', 'error', 'disabled'] })
    .notNull()
    .default('idle'),
  syncError: text('sync_error'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
});

export const folders = sqliteTable(
  'folders',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    accountId: integer('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
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

export const folderSyncState = sqliteTable(
  'folder_sync_state',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    accountId: integer('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    folderPath: text('folder_path').notNull(),
    uidValidity: text('uid_validity'),
    highestUid: integer('highest_uid').notNull().default(0),
    lastSyncedAt: text('last_synced_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull()
  },
  (table) => ({
    accountFolderUnique: uniqueIndex('folder_sync_state_account_path_unique').on(
      table.accountId,
      table.folderPath
    )
  })
);

export const messages = sqliteTable(
  'messages',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    accountId: integer('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    providerMessageId: text('provider_message_id').notNull(),
    threadId: text('thread_id'),
    messageIdHeader: text('message_id_header'),
    inReplyTo: text('in_reply_to'),
    references: text('references'),
    folderPath: text('folder_path').notNull(),
    subject: text('subject').notNull(),
    from: text('from').notNull(),
    to: text('to').notNull(),
    cc: text('cc'),
    bcc: text('bcc'),
    date: text('date').notNull(),
    bodyText: text('body_text').notNull(),
    bodyHtml: text('body_html'),
    isRead: integer('is_read', { mode: 'boolean' }).notNull().default(false),
    isAnswered: integer('is_answered', { mode: 'boolean' }).notNull().default(false),
    isFlagged: integer('is_flagged', { mode: 'boolean' }).notNull().default(false),
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

export const messageAttachments = sqliteTable('message_attachments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  messageId: integer('message_id')
    .notNull()
    .references(() => messages.id, { onDelete: 'cascade' }),
  filename: text('filename').notNull(),
  contentType: text('content_type').notNull(),
  sizeBytes: integer('size_bytes').notNull().default(0),
  contentId: text('content_id'),
  disposition: text('disposition'),
  contentBase64: text('content_base64'),
  createdAt: text('created_at').notNull()
});

export const contacts = sqliteTable(
  'contacts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    accountId: integer('account_id').references(() => accounts.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    name: text('name'),
    source: text('source').notNull().default('observed'),
    lastSeenAt: text('last_seen_at').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull()
  },
  (table) => ({
    accountEmail: uniqueIndex('contacts_account_email_unique').on(table.accountId, table.email)
  })
);

export const drafts = sqliteTable('drafts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  accountId: integer('account_id').references(() => accounts.id, { onDelete: 'cascade' }),
  mode: text('mode', { enum: ['compose', 'reply', 'reply_all', 'forward'] })
    .notNull()
    .default('compose'),
  sourceMessageId: integer('source_message_id').references(() => messages.id, {
    onDelete: 'set null'
  }),
  to: text('to').notNull().default(''),
  cc: text('cc'),
  bcc: text('bcc'),
  subject: text('subject').notNull().default(''),
  bodyText: text('body_text').notNull().default(''),
  bodyHtml: text('body_html'),
  attachmentsJson: text('attachments_json'),
  status: text('status', { enum: ['draft', 'queued', 'sent'] })
    .notNull()
    .default('draft'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
});

export const aiSuggestions = sqliteTable('ai_suggestions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  messageId: integer('message_id')
    .notNull()
    .references(() => messages.id, { onDelete: 'cascade' }),
  category: text('category').notNull(),
  confidence: real('confidence').notNull(),
  recommendedAction: text('recommended_action', {
    enum: [
      'reply',
      'forward',
      'move_to_folder',
      'delete',
      'spam',
      'delegate',
      'archive',
      'no_action'
    ]
  }).notNull(),
  targetFolder: text('target_folder'),
  draftReply: text('draft_reply'),
  forwardTo: text('forward_to'),
  delegateInstructions: text('delegate_instructions'),
  reasoningSummary: text('reasoning_summary').notNull(),
  riskLevel: text('risk_level', { enum: ['low', 'medium', 'high'] }).notNull(),
  status: text('status', {
    enum: ['pending', 'approved', 'rejected', 'edited', 'executed', 'error']
  })
    .notNull()
    .default('pending'),
  errorMessage: text('error_message'),
  rawModel: text('raw_model'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
});

export const feedbackLog = sqliteTable('feedback_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  messageId: integer('message_id')
    .notNull()
    .references(() => messages.id, { onDelete: 'cascade' }),
  suggestionId: integer('suggestion_id').references(() => aiSuggestions.id, {
    onDelete: 'set null'
  }),
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
  messageId: integer('message_id')
    .notNull()
    .references(() => messages.id, { onDelete: 'cascade' }),
  suggestionId: integer('suggestion_id')
    .notNull()
    .references(() => aiSuggestions.id, { onDelete: 'cascade' }),
  actionType: text('action_type').notNull(),
  status: text('status').notNull(),
  detailsJson: text('details_json').notNull(),
  createdAt: text('created_at').notNull()
});

export const agentActionQueue = sqliteTable(
  'agent_action_queue',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    messageId: integer('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    suggestionId: integer('suggestion_id').references(() => aiSuggestions.id, {
      onDelete: 'cascade'
    }),
    taskRunId: integer('task_run_id'),
    actionType: text('action_type').notNull(),
    riskLevel: text('risk_level', { enum: ['low', 'medium', 'high'] })
      .notNull()
      .default('medium'),
    status: text('status', {
      enum: ['proposed', 'approved', 'executing', 'executed', 'rejected', 'failed']
    })
      .notNull()
      .default('proposed'),
    title: text('title').notNull(),
    detailsJson: text('details_json').notNull(),
    approvalReason: text('approval_reason').notNull(),
    source: text('source').notNull().default('autopilot'),
    idempotencyKey: text('idempotency_key').notNull(),
    errorMessage: text('error_message'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    executedAt: text('executed_at')
  },
  (table) => ({
    idempotencyUnique: uniqueIndex('agent_action_queue_idempotency_unique').on(table.idempotencyKey)
  })
);

export const autopilotRuns = sqliteTable('autopilot_runs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  status: text('status', { enum: ['running', 'completed', 'failed'] })
    .notNull()
    .default('running'),
  mode: text('mode', { enum: ['dry_run', 'assistive'] })
    .notNull()
    .default('dry_run'),
  scannedCount: integer('scanned_count').notNull().default(0),
  suggestedCount: integer('suggested_count').notNull().default(0),
  queuedCount: integer('queued_count').notNull().default(0),
  executedCount: integer('executed_count').notNull().default(0),
  errorMessage: text('error_message'),
  summaryJson: text('summary_json').notNull().default('{}'),
  startedAt: text('started_at').notNull(),
  finishedAt: text('finished_at')
});

export const aiObservability = sqliteTable('ai_observability', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  messageId: integer('message_id').references(() => messages.id, { onDelete: 'set null' }),
  suggestionId: integer('suggestion_id').references(() => aiSuggestions.id, {
    onDelete: 'set null'
  }),
  taskRunId: integer('task_run_id'),
  operation: text('operation').notNull(),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  status: text('status', { enum: ['ok', 'error'] }).notNull(),
  latencyMs: integer('latency_ms').notNull().default(0),
  promptHash: text('prompt_hash').notNull(),
  estimatedCostCents: real('estimated_cost_cents').notNull().default(0),
  errorMessage: text('error_message'),
  createdAt: text('created_at').notNull()
});

export const threadSummaries = sqliteTable(
  'thread_summaries',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    accountId: integer('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    threadKey: text('thread_key').notNull(),
    subject: text('subject').notNull(),
    summary: text('summary').notNull(),
    openQuestions: text('open_questions').notNull().default('[]'),
    commitments: text('commitments').notNull().default('[]'),
    nextAction: text('next_action').notNull(),
    urgency: text('urgency', { enum: ['low', 'medium', 'high'] })
      .notNull()
      .default('low'),
    updatedAt: text('updated_at').notNull(),
    createdAt: text('created_at').notNull()
  },
  (table) => ({
    threadUnique: uniqueIndex('thread_summaries_account_thread_unique').on(
      table.accountId,
      table.threadKey
    )
  })
);

export const followUpReminders = sqliteTable('follow_up_reminders', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  messageId: integer('message_id')
    .notNull()
    .references(() => messages.id, { onDelete: 'cascade' }),
  dueAt: text('due_at').notNull(),
  reason: text('reason').notNull(),
  status: text('status', { enum: ['open', 'done', 'dismissed'] })
    .notNull()
    .default('open'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
});

export const outcomeEvents = sqliteTable('outcome_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  messageId: integer('message_id')
    .notNull()
    .references(() => messages.id, { onDelete: 'cascade' }),
  suggestionId: integer('suggestion_id').references(() => aiSuggestions.id, {
    onDelete: 'set null'
  }),
  actionQueueId: integer('action_queue_id').references(() => agentActionQueue.id, {
    onDelete: 'set null'
  }),
  outcomeType: text('outcome_type', {
    enum: [
      'resolved',
      'needs_followup',
      'bad_draft',
      'wrong_action',
      'positive_reply',
      'negative_reply'
    ]
  }).notNull(),
  notes: text('notes'),
  createdAt: text('created_at').notNull()
});

export const agentTools = sqliteTable('agent_tools', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  description: text('description'),
  kind: text('kind', { enum: ['mcp_http', 'cli'] }).notNull(),
  endpoint: text('endpoint'),
  command: text('command'),
  argsJson: text('args_json'),
  authHeadersEncrypted: text('auth_headers_encrypted'),
  envEncrypted: text('env_encrypted'),
  isEnabled: integer('is_enabled', { mode: 'boolean' }).notNull().default(true),
  readOnly: integer('read_only', { mode: 'boolean' }).notNull().default(false),
  requireApprovalForWrite: integer('require_approval_for_write', { mode: 'boolean' })
    .notNull()
    .default(true),
  timeoutMs: integer('timeout_ms').notNull().default(30000),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
});

export const taskRuns = sqliteTable('task_runs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  messageId: integer('message_id')
    .notNull()
    .references(() => messages.id, { onDelete: 'cascade' }),
  suggestionId: integer('suggestion_id').references(() => aiSuggestions.id, {
    onDelete: 'set null'
  }),
  status: text('status', {
    enum: ['planned', 'needs_approval', 'running', 'completed', 'failed', 'rejected', 'cancelled']
  })
    .notNull()
    .default('planned'),
  complexity: text('complexity', { enum: ['simple', 'advanced'] })
    .notNull()
    .default('simple'),
  modelUsed: text('model_used').notNull(),
  providerUsed: text('provider_used').notNull(),
  summary: text('summary').notNull(),
  planJson: text('plan_json').notNull(),
  resultSummary: text('result_summary'),
  errorMessage: text('error_message'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
});

export const taskSteps = sqliteTable('task_steps', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  taskRunId: integer('task_run_id')
    .notNull()
    .references(() => taskRuns.id, { onDelete: 'cascade' }),
  stepIndex: integer('step_index').notNull(),
  title: text('title').notNull(),
  kind: text('kind', {
    enum: ['draft_reply', 'move_to_folder', 'tool_call', 'delegate', 'mark_done']
  }).notNull(),
  details: text('details').notNull(),
  toolName: text('tool_name'),
  toolInputJson: text('tool_input_json'),
  status: text('status', {
    enum: ['pending', 'approved', 'running', 'completed', 'failed', 'rejected']
  })
    .notNull()
    .default('pending'),
  requiresApproval: integer('requires_approval', { mode: 'boolean' }).notNull().default(true),
  riskLevel: text('risk_level', { enum: ['low', 'medium', 'high'] })
    .notNull()
    .default('low'),
  outputJson: text('output_json'),
  errorMessage: text('error_message'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
});

export const toolCalls = sqliteTable('tool_calls', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  taskRunId: integer('task_run_id').references(() => taskRuns.id, { onDelete: 'cascade' }),
  taskStepId: integer('task_step_id').references(() => taskSteps.id, { onDelete: 'set null' }),
  toolId: integer('tool_id').references(() => agentTools.id, { onDelete: 'set null' }),
  toolName: text('tool_name').notNull(),
  requestJson: text('request_json').notNull(),
  responseJson: text('response_json'),
  status: text('status', { enum: ['completed', 'failed'] }).notNull(),
  durationMs: integer('duration_ms').notNull().default(0),
  createdAt: text('created_at').notNull()
});

export const automationPolicies = sqliteTable('automation_policies', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  alwaysRequireApproval: integer('always_require_approval', { mode: 'boolean' })
    .notNull()
    .default(true),
  autoApproveReadOnlyToolCalls: integer('auto_approve_read_only_tool_calls', { mode: 'boolean' })
    .notNull()
    .default(true),
  autopilotEnabled: integer('autopilot_enabled', { mode: 'boolean' }).notNull().default(false),
  dryRunOnly: integer('dry_run_only', { mode: 'boolean' }).notNull().default(true),
  allowAutoFileLowRisk: integer('allow_auto_file_low_risk', { mode: 'boolean' })
    .notNull()
    .default(false),
  allowAutoNoActionLowRisk: integer('allow_auto_no_action_low_risk', { mode: 'boolean' })
    .notNull()
    .default(false),
  requireApprovalForSend: integer('require_approval_for_send', { mode: 'boolean' })
    .notNull()
    .default(true),
  maxMessagesPerRun: integer('max_messages_per_run').notNull().default(25),
  maxAutoActionsPerRun: integer('max_auto_actions_per_run').notNull().default(5),
  followUpDays: integer('follow_up_days').notNull().default(2),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
});

export const aiProfiles = sqliteTable(
  'ai_profiles',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    profile: text('profile', { enum: ['primary', 'fallback', 'advanced', 'audio'] }).notNull(),
    label: text('label').notNull(),
    provider: text('provider').notNull(),
    transport: text('transport', { enum: ['openai_compatible', 'anthropic'] })
      .notNull()
      .default('openai_compatible'),
    model: text('model').notNull(),
    baseUrl: text('base_url').notNull(),
    apiKeyEncrypted: text('api_key_encrypted'),
    preset: text('preset'),
    isEnabled: integer('is_enabled', { mode: 'boolean' }).notNull().default(true),
    notes: text('notes'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull()
  },
  (table) => ({
    profileUnique: uniqueIndex('ai_profiles_profile_unique').on(table.profile)
  })
);

export const oauthProviders = sqliteTable(
  'oauth_providers',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    provider: text('provider', { enum: ['google'] }).notNull(),
    clientId: text('client_id').notNull(),
    clientSecretEncrypted: text('client_secret_encrypted').notNull(),
    redirectUri: text('redirect_uri').notNull(),
    scopes: text('scopes').notNull(),
    isEnabled: integer('is_enabled', { mode: 'boolean' }).notNull().default(true),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull()
  },
  (table) => ({
    providerUnique: uniqueIndex('oauth_providers_provider_unique').on(table.provider)
  })
);

export const memoryProfile = sqliteTable('memory_profile', {
  id: integer('id').primaryKey(),
  coreProfile: text('core_profile').notNull(),
  advancedMode: integer('advanced_mode', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
});

export const memoryEvents = sqliteTable('memory_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  eventType: text('event_type', {
    enum: ['suggestion_edit', 'suggestion_regenerate', 'task_edit']
  }).notNull(),
  messageId: integer('message_id')
    .notNull()
    .references(() => messages.id, { onDelete: 'cascade' }),
  suggestionId: integer('suggestion_id').references(() => aiSuggestions.id, {
    onDelete: 'set null'
  }),
  contextJson: text('context_json').notNull(),
  beforeText: text('before_text').notNull(),
  afterText: text('after_text').notNull(),
  note: text('note'),
  createdAt: text('created_at').notNull()
});

export const memoryRules = sqliteTable('memory_rules', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  kind: text('kind').notNull(),
  scope: text('scope').notNull(),
  ruleText: text('rule_text').notNull(),
  confidence: real('confidence').notNull().default(0.5),
  usageCount: integer('usage_count').notNull().default(1),
  lastSeenAt: text('last_seen_at').notNull(),
  sourceEventId: integer('source_event_id').references(() => memoryEvents.id, {
    onDelete: 'set null'
  }),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
});

export const memoryExamples = sqliteTable('memory_examples', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  eventId: integer('event_id').references(() => memoryEvents.id, { onDelete: 'set null' }),
  scope: text('scope').notNull(),
  beforeText: text('before_text').notNull(),
  afterText: text('after_text').notNull(),
  note: text('note'),
  score: real('score').notNull().default(0.5),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
});

export const accountRelations = relations(accounts, ({ many }) => ({
  folders: many(folders),
  messages: many(messages),
  contacts: many(contacts)
}));

export const messageRelations = relations(messages, ({ many, one }) => ({
  account: one(accounts, { fields: [messages.accountId], references: [accounts.id] }),
  suggestions: many(aiSuggestions),
  attachments: many(messageAttachments)
}));

export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type AiSuggestion = typeof aiSuggestions.$inferSelect;
export type Contact = typeof contacts.$inferSelect;
export type MessageAttachment = typeof messageAttachments.$inferSelect;
export type Draft = typeof drafts.$inferSelect;
export type FolderSyncState = typeof folderSyncState.$inferSelect;
export type AgentTool = typeof agentTools.$inferSelect;
export type TaskRun = typeof taskRuns.$inferSelect;
export type TaskStep = typeof taskSteps.$inferSelect;
export type AiProfile = typeof aiProfiles.$inferSelect;
export type MemoryProfile = typeof memoryProfile.$inferSelect;
export type AgentActionQueue = typeof agentActionQueue.$inferSelect;
export type AutopilotRun = typeof autopilotRuns.$inferSelect;
export type ThreadSummary = typeof threadSummaries.$inferSelect;
