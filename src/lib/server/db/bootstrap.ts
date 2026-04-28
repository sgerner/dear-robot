import fs from 'node:fs';
import path from 'node:path';
import { count } from 'drizzle-orm';
import { env } from '../env';
import { encryptSecret } from '../security';
import { aiSuggestions, folders, messages, accounts } from './schema';
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
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  provider_message_id TEXT NOT NULL,
  thread_id TEXT,
  folder_path TEXT NOT NULL,
  subject TEXT NOT NULL,
  "from" TEXT NOT NULL,
  "to" TEXT NOT NULL,
  cc TEXT,
  date TEXT NOT NULL,
  body_text TEXT NOT NULL,
  body_html TEXT,
  is_read INTEGER NOT NULL DEFAULT 0,
  is_answered INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS messages_account_provider_unique ON messages(account_id, provider_message_id);
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
`);

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
        providerMessageId: email.id,
        threadId: email.thread_id ?? null,
        folderPath: 'INBOX',
        subject: email.subject,
        from: email.from,
        to: email.to,
        cc: email.cc ?? null,
        date: email.date,
        bodyText: email.body_text,
        bodyHtml: null,
        isRead: false,
        isAnswered: false,
        createdAt: now,
        updatedAt: now
      })
      .returning()
      .get();
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
  const memoryPath = path.join(env.DATA_DIR, 'AGENT_INSTRUCTIONS.md');
  if (!fs.existsSync(memoryPath)) fs.writeFileSync(memoryPath, defaultAgentInstructions, 'utf8');
}

function readFixtureEmails(): FixtureEmail[] {
  const fixturePath = path.join(process.cwd(), 'tests/fixtures/emails.json');
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as FixtureEmail[];
}

export function resetForTests() {
  sqlite.exec(`
DELETE FROM executed_actions;
DELETE FROM feedback_log;
DELETE FROM ai_suggestions;
DELETE FROM messages;
DELETE FROM folders;
DELETE FROM accounts;
`);
  try {
    sqlite.exec(`DELETE FROM messages_fts;`);
  } catch {
    // Ignore when FTS5 is unavailable in the runtime SQLite build.
  }
  bootstrapped = false;
  bootstrapDatabase();
}
