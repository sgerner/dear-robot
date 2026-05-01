import fs from 'node:fs';
import path from 'node:path';
import { count, eq } from 'drizzle-orm';
import { env } from '../env';
import { encryptSecret } from '../security';
import { aiProfiles, aiSuggestions, contacts, drafts, folders, messageAttachments, messages, accounts, automationPolicies } from './schema';
import { db, nowIso, sqlite } from './index';
import { defaultAgentInstructions, ensureAgentInstructions } from '../memory';

type FixtureEmail = {
  id: string;
  thread_id?: string | null;
  subject: string;
  from: string;
  to: string;
  cc?: string | null;
  date: string;
  body_text: string;
  seed_suggestion?: {
    category: string;
    confidence: number;
    recommendedAction: 'reply' | 'forward' | 'move_to_folder' | 'delete' | 'spam' | 'delegate' | 'archive' | 'no_action';
    targetFolder: string | null;
    draftReply: string | null;
    forwardTo: string | null;
    delegateInstructions: string | null;
    reasoningSummary: string;
    riskLevel: 'low' | 'medium' | 'high';
  };
};

let bootstrapped = false;

export function bootstrapDatabase() {
  if (bootstrapped) return;
  bootstrapped = true;

  sqlite.exec(`
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  host TEXT NOT NULL,
  port INTEGER NOT NULL,
  username TEXT NOT NULL,
  password_encrypted TEXT NOT NULL,
  smtp_host TEXT NOT NULL,
  smtp_port INTEGER NOT NULL,
  smtp_username TEXT NOT NULL,
  smtp_password_encrypted TEXT NOT NULL,
  auth_type TEXT NOT NULL DEFAULT 'password',
  oauth_provider TEXT,
  oauth_access_token_encrypted TEXT,
  oauth_refresh_token_encrypted TEXT,
  oauth_access_token_expires_at TEXT,
  is_enabled INTEGER NOT NULL DEFAULT 1,
  last_sync_at TEXT,
  sync_status TEXT NOT NULL DEFAULT 'idle',
  sync_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  role TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS folders_account_path_unique ON folders(account_id, path);
CREATE TABLE IF NOT EXISTS folder_sync_state (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  folder_path TEXT NOT NULL,
  uid_validity TEXT,
  highest_uid INTEGER NOT NULL DEFAULT 0,
  last_synced_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS folder_sync_state_account_path_unique ON folder_sync_state(account_id, folder_path);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  provider_message_id TEXT NOT NULL,
  thread_id TEXT,
  message_id_header TEXT,
  in_reply_to TEXT,
  "references" TEXT,
  folder_path TEXT NOT NULL,
  subject TEXT NOT NULL,
  "from" TEXT NOT NULL,
  "to" TEXT NOT NULL,
  cc TEXT,
  bcc TEXT,
  date TEXT NOT NULL,
  body_text TEXT NOT NULL,
  body_html TEXT,
  is_read INTEGER NOT NULL DEFAULT 0,
  is_answered INTEGER NOT NULL DEFAULT 0,
  is_flagged INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS messages_account_provider_unique ON messages(account_id, provider_message_id);
CREATE INDEX IF NOT EXISTS messages_account_folder_date_idx ON messages(account_id, folder_path, date);
CREATE INDEX IF NOT EXISTS messages_account_thread_idx ON messages(account_id, thread_id);
CREATE TABLE IF NOT EXISTS message_attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  content_id TEXT,
  disposition TEXT,
  content_base64 TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT,
  source TEXT NOT NULL DEFAULT 'observed',
  last_seen_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS contacts_account_email_unique ON contacts(account_id, email);
CREATE TABLE IF NOT EXISTS drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'compose',
  source_message_id INTEGER REFERENCES messages(id) ON DELETE SET NULL,
  "to" TEXT NOT NULL DEFAULT '',
  cc TEXT,
  bcc TEXT,
  subject TEXT NOT NULL DEFAULT '',
  body_text TEXT NOT NULL DEFAULT '',
  body_html TEXT,
  attachments_json TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  confidence REAL NOT NULL,
  recommended_action TEXT NOT NULL,
  target_folder TEXT,
  draft_reply TEXT,
  forward_to TEXT,
  delegate_instructions TEXT,
  reasoning_summary TEXT NOT NULL,
  risk_level TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  raw_model TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS feedback_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  suggestion_id INTEGER REFERENCES ai_suggestions(id) ON DELETE SET NULL,
  original_suggestion TEXT NOT NULL,
  user_correction TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS webhook_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  target_url TEXT NOT NULL,
  secret TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS executed_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  suggestion_id INTEGER NOT NULL REFERENCES ai_suggestions(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  status TEXT NOT NULL,
  details_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_action_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  suggestion_id INTEGER REFERENCES ai_suggestions(id) ON DELETE CASCADE,
  task_run_id INTEGER,
  action_type TEXT NOT NULL,
  risk_level TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'proposed',
  title TEXT NOT NULL,
  details_json TEXT NOT NULL,
  approval_reason TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'autopilot',
  idempotency_key TEXT NOT NULL,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  executed_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS agent_action_queue_idempotency_unique ON agent_action_queue(idempotency_key);
CREATE TABLE IF NOT EXISTS autopilot_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  status TEXT NOT NULL DEFAULT 'running',
  mode TEXT NOT NULL DEFAULT 'dry_run',
  scanned_count INTEGER NOT NULL DEFAULT 0,
  suggested_count INTEGER NOT NULL DEFAULT 0,
  queued_count INTEGER NOT NULL DEFAULT 0,
  executed_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  summary_json TEXT NOT NULL DEFAULT '{}',
  started_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE TABLE IF NOT EXISTS ai_observability (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER REFERENCES messages(id) ON DELETE SET NULL,
  suggestion_id INTEGER REFERENCES ai_suggestions(id) ON DELETE SET NULL,
  task_run_id INTEGER REFERENCES task_runs(id) ON DELETE SET NULL,
  operation TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  prompt_hash TEXT NOT NULL,
  estimated_cost_cents REAL NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS thread_summaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  thread_key TEXT NOT NULL,
  subject TEXT NOT NULL,
  summary TEXT NOT NULL,
  open_questions TEXT NOT NULL DEFAULT '[]',
  commitments TEXT NOT NULL DEFAULT '[]',
  next_action TEXT NOT NULL,
  urgency TEXT NOT NULL DEFAULT 'low',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS thread_summaries_account_thread_unique ON thread_summaries(account_id, thread_key);
CREATE TABLE IF NOT EXISTS follow_up_reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  due_at TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS outcome_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  suggestion_id INTEGER REFERENCES ai_suggestions(id) ON DELETE SET NULL,
  action_queue_id INTEGER REFERENCES agent_action_queue(id) ON DELETE SET NULL,
  outcome_type TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_tools (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  kind TEXT NOT NULL,
  endpoint TEXT,
  command TEXT,
  args_json TEXT,
  auth_headers_encrypted TEXT,
  env_encrypted TEXT,
  is_enabled INTEGER NOT NULL DEFAULT 1,
  read_only INTEGER NOT NULL DEFAULT 0,
  require_approval_for_write INTEGER NOT NULL DEFAULT 1,
  timeout_ms INTEGER NOT NULL DEFAULT 30000,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS task_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  suggestion_id INTEGER REFERENCES ai_suggestions(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'planned',
  complexity TEXT NOT NULL DEFAULT 'simple',
  model_used TEXT NOT NULL,
  provider_used TEXT NOT NULL,
  summary TEXT NOT NULL,
  plan_json TEXT NOT NULL,
  result_summary TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS task_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_run_id INTEGER NOT NULL REFERENCES task_runs(id) ON DELETE CASCADE,
  step_index INTEGER NOT NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  details TEXT NOT NULL,
  tool_name TEXT,
  tool_input_json TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  requires_approval INTEGER NOT NULL DEFAULT 1,
  risk_level TEXT NOT NULL DEFAULT 'low',
  output_json TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tool_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_run_id INTEGER REFERENCES task_runs(id) ON DELETE CASCADE,
  task_step_id INTEGER REFERENCES task_steps(id) ON DELETE SET NULL,
  tool_id INTEGER REFERENCES agent_tools(id) ON DELETE SET NULL,
  tool_name TEXT NOT NULL,
  request_json TEXT NOT NULL,
  response_json TEXT,
  status TEXT NOT NULL,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS automation_policies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  always_require_approval INTEGER NOT NULL DEFAULT 1,
  auto_approve_read_only_tool_calls INTEGER NOT NULL DEFAULT 0,
  autopilot_enabled INTEGER NOT NULL DEFAULT 0,
  dry_run_only INTEGER NOT NULL DEFAULT 1,
  allow_auto_file_low_risk INTEGER NOT NULL DEFAULT 0,
  allow_auto_no_action_low_risk INTEGER NOT NULL DEFAULT 0,
  require_approval_for_send INTEGER NOT NULL DEFAULT 1,
  max_messages_per_run INTEGER NOT NULL DEFAULT 25,
  max_auto_actions_per_run INTEGER NOT NULL DEFAULT 5,
  follow_up_days INTEGER NOT NULL DEFAULT 2,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile TEXT NOT NULL,
  label TEXT NOT NULL,
  provider TEXT NOT NULL,
  transport TEXT NOT NULL DEFAULT 'openai_compatible',
  model TEXT NOT NULL,
  base_url TEXT NOT NULL,
  api_key_encrypted TEXT,
  preset TEXT,
  is_enabled INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ai_profiles_profile_unique ON ai_profiles(profile);
CREATE TABLE IF NOT EXISTS oauth_providers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  client_id TEXT NOT NULL,
  client_secret_encrypted TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  scopes TEXT NOT NULL,
  is_enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS oauth_providers_provider_unique ON oauth_providers(provider);
CREATE TABLE IF NOT EXISTS memory_profile (
  id INTEGER PRIMARY KEY,
  core_profile TEXT NOT NULL,
  advanced_mode INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS memory_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  suggestion_id INTEGER REFERENCES ai_suggestions(id) ON DELETE SET NULL,
  context_json TEXT NOT NULL,
  before_text TEXT NOT NULL,
  after_text TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS memory_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  scope TEXT NOT NULL,
  rule_text TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.5,
  usage_count INTEGER NOT NULL DEFAULT 1,
  last_seen_at TEXT NOT NULL,
  source_event_id INTEGER REFERENCES memory_events(id) ON DELETE SET NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS memory_examples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER REFERENCES memory_events(id) ON DELETE SET NULL,
  scope TEXT NOT NULL,
  before_text TEXT NOT NULL,
  after_text TEXT NOT NULL,
  note TEXT,
  score REAL NOT NULL DEFAULT 0.5,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`);
  migrateMessageClientColumns();
  migrateAccountAuthColumns();
  migrateAutomationPolicyColumns();

  // FTS5 index for message search with triggers to keep it in sync.
  try {
    sqlite.exec(`
DROP TRIGGER IF EXISTS messages_ai;
DROP TRIGGER IF EXISTS messages_ad;
DROP TRIGGER IF EXISTS messages_au;
DROP TABLE IF EXISTS messages_fts;
CREATE VIRTUAL TABLE messages_fts USING fts5(
  subject,
  sender,
  recipients,
  body_text
);
CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, subject, sender, recipients, body_text)
  VALUES (new.id, new.subject, new."from", new."to", new.body_text);
END;
CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
  DELETE FROM messages_fts WHERE rowid = old.id;
END;
CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
  DELETE FROM messages_fts WHERE rowid = old.id;
  INSERT INTO messages_fts(rowid, subject, sender, recipients, body_text)
  VALUES (new.id, new.subject, new."from", new."to", new.body_text);
END;
INSERT INTO messages_fts(rowid, subject, sender, recipients, body_text)
SELECT id, subject, "from", "to", body_text FROM messages;
`);
  } catch (error) {
    console.warn('[triage] FTS5 unavailable, falling back to LIKE search.', error);
  }

  fs.mkdirSync(env.DATA_DIR, { recursive: true });
  ensureAgentInstructions();
  seedMockDataIfEmpty();
  seedAutomationDefaults();
  seedAiDefaults();
}

function seedMockDataIfEmpty() {
  const existing = db.select({ value: count() }).from(accounts).get()?.value ?? 0;
  if (existing > 0) return;
  const now = nowIso();
  const account = db
    .insert(accounts)
    .values({
      email: 'mock@example.test',
      host: 'mock',
      port: 993,
      username: 'mock@example.test',
      passwordEncrypted: encryptSecret('mock-password'),
      smtpHost: 'mock',
      smtpPort: 465,
      smtpUsername: 'mock@example.test',
      smtpPasswordEncrypted: encryptSecret('mock-password'),
      isEnabled: true,
      syncStatus: 'idle',
      createdAt: now,
      updatedAt: now
    })
    .returning()
    .get();
  const folderRows = ['INBOX', 'Newsletters', 'Receipts', 'Spam Review', 'Archive', 'Trash'].map((name) => ({
    accountId: account.id,
    name,
    path: name,
    role: name === 'INBOX' ? 'inbox' : name.toLowerCase().replaceAll(' ', '_'),
    createdAt: now,
    updatedAt: now
  }));
  db.insert(folders).values(folderRows).run();
  for (const email of readFixtureEmails()) {
    const msg = db
      .insert(messages)
      .values({
        accountId: account.id,
        providerMessageId: `INBOX:${email.id}`,
        threadId: email.thread_id ?? null,
        messageIdHeader: `<${email.id}@fixtures.triage.local>`,
        inReplyTo: null,
        references: null,
        folderPath: 'INBOX',
        subject: email.subject,
        from: email.from,
        to: email.to,
        cc: email.cc ?? null,
        bcc: null,
        date: email.date,
        bodyText: email.body_text,
        bodyHtml: null,
        isRead: false,
        isAnswered: false,
        isFlagged: false,
        createdAt: now,
        updatedAt: now
      })
      .returning()
      .get();
    db.insert(messageAttachments)
      .values({
        messageId: msg.id,
        filename: 'note.txt',
        contentType: 'text/plain',
        sizeBytes: 18,
        contentId: null,
        disposition: 'attachment',
        contentBase64: Buffer.from('fixture attachment', 'utf8').toString('base64'),
        createdAt: now
      })
      .run();
    if (email.seed_suggestion) {
      db.insert(aiSuggestions)
        .values({
          messageId: msg.id,
          ...email.seed_suggestion,
          status: 'pending',
          rawModel: null,
          errorMessage: null,
          createdAt: now,
          updatedAt: now
        })
        .run();
    }
  }
  seedContactsForMessages(account.id);
  seedDraft(account.id);
  const memoryPath = path.join(env.DATA_DIR, 'AGENT_INSTRUCTIONS.md');
  if (!fs.existsSync(memoryPath)) fs.writeFileSync(memoryPath, defaultAgentInstructions, 'utf8');
}

function seedAutomationDefaults() {
  const existing = db.select({ value: count() }).from(automationPolicies).get()?.value ?? 0;
  if (existing > 0) return;
  const now = nowIso();
  db.insert(automationPolicies)
    .values({
      name: 'default',
      alwaysRequireApproval: true,
      autoApproveReadOnlyToolCalls: true,
      autopilotEnabled: false,
      dryRunOnly: true,
      allowAutoFileLowRisk: false,
      allowAutoNoActionLowRisk: false,
      requireApprovalForSend: true,
      maxMessagesPerRun: 25,
      maxAutoActionsPerRun: 5,
      followUpDays: 2,
      createdAt: now,
      updatedAt: now
    })
    .run();
  db.update(automationPolicies)
    .set({ autoApproveReadOnlyToolCalls: true, updatedAt: now })
    .where(eq(automationPolicies.name, 'default'))
    .run();
}

function seedAiDefaults() {
  const existing = db.select({ value: count() }).from(aiProfiles).get()?.value ?? 0;
  if (existing > 0) return;
  const now = nowIso();
  db.insert(aiProfiles)
    .values([
      {
        profile: 'primary',
        label: 'Primary',
        provider: env.AI_PROVIDER || 'deepseek',
        transport: 'openai_compatible',
        model: env.AI_MODEL || 'deepseek-v4-flash',
        baseUrl: env.AI_BASE_URL || 'https://api.deepseek.com',
        apiKeyEncrypted: env.AI_API_KEY ? encryptSecret(env.AI_API_KEY) : null,
        preset: env.AI_PROVIDER || 'deepseek',
        isEnabled: true,
        notes: 'Fast default triage model.',
        createdAt: now,
        updatedAt: now
      },
      {
        profile: 'fallback',
        label: 'Fallback',
        provider: env.AI_FALLBACK_PROVIDER || 'gemini',
        transport: 'openai_compatible',
        model: env.AI_FALLBACK_MODEL || 'gemini-2.5-flash',
        baseUrl: env.AI_FALLBACK_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai/',
        apiKeyEncrypted: env.AI_FALLBACK_API_KEY ? encryptSecret(env.AI_FALLBACK_API_KEY) : null,
        preset: env.AI_FALLBACK_PROVIDER || 'gemini',
        isEnabled: true,
        notes: 'Fallback provider when the primary model fails.',
        createdAt: now,
        updatedAt: now
      },
      {
        profile: 'advanced',
        label: 'Advanced Planner',
        provider: env.AI_ADVANCED_PROVIDER || env.AI_PROVIDER || 'deepseek',
        transport: 'openai_compatible',
        model: env.AI_ADVANCED_MODEL || 'deepseek-v4-pro',
        baseUrl: env.AI_ADVANCED_BASE_URL || env.AI_BASE_URL || 'https://api.deepseek.com',
        apiKeyEncrypted: env.AI_ADVANCED_API_KEY ? encryptSecret(env.AI_ADVANCED_API_KEY) : null,
        preset: env.AI_ADVANCED_PROVIDER || 'deepseek',
        isEnabled: true,
        notes: 'Used for complex multi-step planning.',
        createdAt: now,
        updatedAt: now
      },
      {
        profile: 'audio',
        label: 'Dictation (Speech-to-Text)',
        provider: 'deepgram',
        transport: 'openai_compatible',
        model: 'nova-3',
        baseUrl: 'https://api.deepgram.com',
        apiKeyEncrypted: null,
        preset: 'deepgram',
        isEnabled: true,
        notes: 'Speech-to-text dictation provider',
        createdAt: now,
        updatedAt: now
      }
    ])
    .run();
}

function migrateMessageClientColumns() {
  const columns = sqlite.prepare(`PRAGMA table_info(messages)`).all() as Array<{ name: string }>;
  const existing = new Set(columns.map((column) => column.name));
  const additions: Array<[string, string]> = [
    ['message_id_header', 'TEXT'],
    ['in_reply_to', 'TEXT'],
    ['references', 'TEXT'],
    ['bcc', 'TEXT'],
    ['is_flagged', 'INTEGER NOT NULL DEFAULT 0']
  ];
  for (const [name, definition] of additions) {
    if (!existing.has(name)) sqlite.exec(`ALTER TABLE messages ADD COLUMN "${name}" ${definition};`);
  }
}

function migrateAccountAuthColumns() {
  const columns = sqlite.prepare(`PRAGMA table_info(accounts)`).all() as Array<{ name: string }>;
  const existing = new Set(columns.map((column) => column.name));
  const additions: Array<[string, string]> = [
    ['auth_type', "TEXT NOT NULL DEFAULT 'password'"],
    ['oauth_provider', 'TEXT'],
    ['oauth_access_token_encrypted', 'TEXT'],
    ['oauth_refresh_token_encrypted', 'TEXT'],
    ['oauth_access_token_expires_at', 'TEXT']
  ];
  for (const [name, definition] of additions) {
    if (!existing.has(name)) sqlite.exec(`ALTER TABLE accounts ADD COLUMN "${name}" ${definition};`);
  }
}

function migrateAutomationPolicyColumns() {
  const columns = sqlite.prepare(`PRAGMA table_info(automation_policies)`).all() as Array<{ name: string }>;
  const existing = new Set(columns.map((column) => column.name));
  const additions: Array<[string, string]> = [
    ['autopilot_enabled', 'INTEGER NOT NULL DEFAULT 0'],
    ['dry_run_only', 'INTEGER NOT NULL DEFAULT 1'],
    ['allow_auto_file_low_risk', 'INTEGER NOT NULL DEFAULT 0'],
    ['allow_auto_no_action_low_risk', 'INTEGER NOT NULL DEFAULT 0'],
    ['require_approval_for_send', 'INTEGER NOT NULL DEFAULT 1'],
    ['max_messages_per_run', 'INTEGER NOT NULL DEFAULT 25'],
    ['max_auto_actions_per_run', 'INTEGER NOT NULL DEFAULT 5'],
    ['follow_up_days', 'INTEGER NOT NULL DEFAULT 2']
  ];
  for (const [name, definition] of additions) {
    if (!existing.has(name)) sqlite.exec(`ALTER TABLE automation_policies ADD COLUMN "${name}" ${definition};`);
  }
}

function seedContactsForMessages(accountId: number) {
  const now = nowIso();
  const rows = db.select().from(messages).where(eq(messages.accountId, accountId)).all();
  for (const message of rows) {
    for (const address of [message.from, message.to, message.cc].filter(Boolean)) {
      for (const contact of extractContacts(address || '')) {
        db.insert(contacts)
          .values({
            accountId,
            email: contact.email,
            name: contact.name,
            source: 'observed',
            lastSeenAt: message.date,
            createdAt: now,
            updatedAt: now
          })
          .onConflictDoUpdate({
            target: [contacts.accountId, contacts.email],
            set: { name: contact.name, lastSeenAt: message.date, updatedAt: now }
          })
          .run();
      }
    }
  }
}

function seedDraft(accountId: number) {
  const now = nowIso();
  db.insert(drafts)
    .values({
      accountId,
      mode: 'compose',
      sourceMessageId: null,
      to: '',
      cc: null,
      bcc: null,
      subject: '',
      bodyText: '',
      bodyHtml: null,
      attachmentsJson: JSON.stringify([]),
      status: 'draft',
      createdAt: now,
      updatedAt: now
    })
    .run();
}

function extractContacts(value: string) {
  return value
    .split(',')
    .map((part) => {
      const match = part.match(/^(.*?)<([^>]+)>$/);
      if (match) return { name: match[1].trim().replace(/^"|"$/g, '') || null, email: match[2].trim().toLowerCase() };
      const email = part.trim().toLowerCase();
      return email.includes('@') ? { name: null, email } : null;
    })
    .filter((contact): contact is { name: string | null; email: string } => Boolean(contact?.email));
}

function readFixtureEmails(): FixtureEmail[] {
  const fixturePath = path.join(process.cwd(), 'tests/fixtures/emails.json');
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as FixtureEmail[];
}

export function resetForTests() {
  try {
    sqlite.exec(`
DELETE FROM executed_actions;
DELETE FROM outcome_events;
DELETE FROM follow_up_reminders;
DELETE FROM thread_summaries;
DELETE FROM ai_observability;
DELETE FROM autopilot_runs;
DELETE FROM agent_action_queue;
DELETE FROM feedback_log;
DELETE FROM ai_suggestions;
DELETE FROM tool_calls;
DELETE FROM task_steps;
DELETE FROM task_runs;
DELETE FROM agent_tools;
DELETE FROM automation_policies;
DELETE FROM ai_profiles;
    DELETE FROM oauth_providers;
    DELETE FROM memory_profile;
    DELETE FROM memory_events;
    DELETE FROM memory_rules;
    DELETE FROM memory_examples;
DELETE FROM drafts;
DELETE FROM message_attachments;
DELETE FROM messages;
DELETE FROM folder_sync_state;
DELETE FROM contacts;
DELETE FROM folders;
DELETE FROM accounts;
`);
  } catch {
    // Fresh in-memory databases may not have been bootstrapped yet.
  }
  try {
    sqlite.exec(`DELETE FROM messages_fts;`);
  } catch {
    // Ignore when FTS5 is unavailable in the runtime SQLite build.
  }
  bootstrapped = false;
  bootstrapDatabase();
}
