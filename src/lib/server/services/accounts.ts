import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, nowIso } from '../db';
import { accounts, aiSuggestions, executedActions, feedbackLog, folders, messages } from '../db/schema';
import { encryptSecret } from '../security';
import { providerForAccount } from '../email/provider';
import { stopSyncWorkerForAccount } from '../sync';

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
    isEnabled: account.isEnabled,
    lastSyncAt: account.lastSyncAt,
    syncStatus: account.syncStatus,
    syncError: account.syncError,
    hasImapPassword: Boolean(account.passwordEncrypted),
    hasSmtpPassword: Boolean(account.smtpPasswordEncrypted),
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

export function createAccount(input: z.infer<typeof AccountInputSchema>) {
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
  return publicAccount(created);
}

export async function testAccount(id: number) {
  const account = getAccount(id);
  if (!account) return { ok: false, message: 'Account not found' };
  return providerForAccount(account).test(account);
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
  const rows = db.select({ id: messages.id }).from(messages).where(eq(messages.accountId, id)).all();
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
