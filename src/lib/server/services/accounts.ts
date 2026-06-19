import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, nowIso } from '../db';
import {
  accounts,
  aiSuggestions,
  executedActions,
  feedbackLog,
  folders,
  messages,
  type Account
} from '../db/schema';
import { encryptSecret } from '../security';
import { providerForAccount } from '../email/provider';
import { startSyncWorkerForAccount, stopSyncWorkerForAccount } from '../sync';

export const AccountInputSchema = z.object({
  email: z.string().email(),
  host: z.string().min(1),
  port: z.coerce.number().int().positive(),
  username: z.string().min(1),
  password: z.string().min(1),
  smtpHost: z.string().min(1),
  smtpPort: z.coerce.number().int().positive(),
  smtpUsername: z.string().min(1),
  smtpPassword: z.string().min(1)
});

const optionalSecretSchema = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().min(1).optional()
);

export const AccountUpdateSchema = AccountInputSchema.omit({
  password: true,
  smtpPassword: true
}).extend({
  password: optionalSecretSchema,
  smtpPassword: optionalSecretSchema
});

export function publicAccount(account: typeof accounts.$inferSelect) {
  return {
    id: account.id,
    email: account.email,
    host: account.host,
    port: account.port,
    username: account.username,
    smtpHost: account.smtpHost,
    smtpPort: account.smtpPort,
    smtpUsername: account.smtpUsername,
    authType: account.authType,
    oauthProvider: account.oauthProvider,
    isEnabled: account.isEnabled,
    lastSyncAt: account.lastSyncAt,
    syncStatus: account.syncStatus,
    syncError: account.syncError,
    hasImapPassword: Boolean(account.passwordEncrypted),
    hasSmtpPassword: Boolean(account.smtpPasswordEncrypted),
    hasOauthRefreshToken: Boolean(account.oauthRefreshTokenEncrypted),
    createdAt: account.createdAt,
    updatedAt: account.updatedAt
  };
}

export function listAccounts() {
  return db.select().from(accounts).orderBy(desc(accounts.createdAt)).all().map(publicAccount);
}

export function getAccount(id: number) {
  return db.select().from(accounts).where(eq(accounts.id, id)).get();
}

export async function createAccount(input: z.infer<typeof AccountInputSchema>) {
  pruneSeededDemoDataIfSafe(input);
  const now = nowIso();
  const created = db
    .insert(accounts)
    .values({
      email: input.email,
      host: input.host,
      port: input.port,
      username: input.username,
      passwordEncrypted: encryptSecret(input.password),
      smtpHost: input.smtpHost,
      smtpPort: input.smtpPort,
      smtpUsername: input.smtpUsername,
      smtpPasswordEncrypted: encryptSecret(input.smtpPassword),
      isEnabled: true,
      syncStatus: 'idle',
      createdAt: now,
      updatedAt: now
    })
    .returning()
    .get();
  if (created.isEnabled) {
    await syncNewAccount(created.id);
  }
  return publicAccount(created);
}

export async function updateAccount(id: number, input: z.infer<typeof AccountUpdateSchema>) {
  const existing = getAccount(id);
  if (!existing) return null;
  const now = nowIso();
  const updated = db
    .update(accounts)
    .set({
      email: input.email,
      host: input.host,
      port: input.port,
      username: input.username,
      passwordEncrypted: input.password ? encryptSecret(input.password) : existing.passwordEncrypted,
      smtpHost: input.smtpHost,
      smtpPort: input.smtpPort,
      smtpUsername: input.smtpUsername,
      smtpPasswordEncrypted: input.smtpPassword
        ? encryptSecret(input.smtpPassword)
        : existing.smtpPasswordEncrypted,
      syncStatus: existing.isEnabled ? 'idle' : 'disabled',
      syncError: null,
      updatedAt: now
    })
    .where(eq(accounts.id, id))
    .returning()
    .get();
  return updated ? publicAccount(updated) : null;
}

async function syncNewAccount(accountId: number) {
  const { syncAccount } = await import('../sync');
  await syncAccount(accountId);
  startSyncWorkerForAccount(accountId, { runInitialSync: false });
}

function pruneSeededDemoDataIfSafe(input: z.infer<typeof AccountInputSchema>) {
  if (input.host === 'mock' && input.email === 'mock@example.test') return;
  const currentAccounts = db.select().from(accounts).all();
  if (currentAccounts.some((account) => account.host !== 'mock')) return;
  const demoAccounts = currentAccounts.filter(
    (account) => account.host === 'mock' && account.email === 'mock@example.test'
  );
  for (const account of demoAccounts) {
    removeAccount(account.id);
  }
}

export async function testAccount(id: number) {
  const account = getAccount(id);
  if (!account) return { ok: false, message: 'Account not found' };
  return providerForAccount(account).test(account);
}

export async function testAccountInput(input: z.infer<typeof AccountInputSchema>) {
  const mockAccount: Record<string, unknown> = {
    email: input.email,
    host: input.host,
    port: input.port,
    username: input.username,
    passwordEncrypted: encryptSecret(input.password),
    smtpHost: input.smtpHost,
    smtpPort: input.smtpPort,
    smtpUsername: input.smtpUsername,
    smtpPasswordEncrypted: encryptSecret(input.smtpPassword),
    authType: 'password'
  };
  return providerForAccount(mockAccount as unknown as Account).test(mockAccount as unknown as Account);
}

export function enableAccount(id: number) {
  const updated = db
    .update(accounts)
    .set({ isEnabled: true, syncStatus: 'idle', syncError: null, updatedAt: nowIso() })
    .where(eq(accounts.id, id))
    .returning()
    .get();
  return updated ? publicAccount(updated) : null;
}

export function disableAccount(id: number) {
  stopSyncWorkerForAccount(id);
  const updated = db
    .update(accounts)
    .set({ isEnabled: false, syncStatus: 'disabled', updatedAt: nowIso() })
    .where(eq(accounts.id, id))
    .returning()
    .get();
  return updated ? publicAccount(updated) : null;
}

export function removeAccount(id: number) {
  stopSyncWorkerForAccount(id);
  const rows = db
    .select({ id: messages.id })
    .from(messages)
    .where(eq(messages.accountId, id))
    .all();
  for (const row of rows) {
    db.delete(executedActions).where(eq(executedActions.messageId, row.id)).run();
    db.delete(feedbackLog).where(eq(feedbackLog.messageId, row.id)).run();
    db.delete(aiSuggestions).where(eq(aiSuggestions.messageId, row.id)).run();
  }
  db.delete(messages).where(eq(messages.accountId, id)).run();
  db.delete(folders).where(eq(folders.accountId, id)).run();
  const result = db.delete(accounts).where(eq(accounts.id, id)).run();
  return result.changes > 0;
}

export function accountFolders(accountId: number) {
  return db.select().from(folders).where(eq(folders.accountId, accountId)).all();
}
