import { beforeEach, describe, expect, it } from 'vitest';

beforeEach(async () => {
  process.env.NODE_ENV = 'test';
  process.env.DB_PATH = ':memory:';
  process.env.APP_PASSWORD = 'test-password';
  process.env.APP_SESSION_SECRET = 'test-session-secret-test-session-secret-1234';
  process.env.ENCRYPTION_KEY = 'test-encryption-key-test-encryption-key-1234';
  const { resetForTests } = await import('../src/lib/server/db/bootstrap');
  resetForTests();
});

describe('account updates', () => {
  it('preserves stored secrets when password fields are left blank', async () => {
    const { db, nowIso } = await import('../src/lib/server/db');
    const { accounts } = await import('../src/lib/server/db/schema');
    const { eq } = await import('drizzle-orm');
    const { AccountUpdateSchema, updateAccount } = await import(
      '../src/lib/server/services/accounts'
    );

    const now = nowIso();
    const created = db
      .insert(accounts)
      .values({
        email: 'user@example.test',
        host: 'imap.example.test',
        port: 993,
        username: 'user@example.test',
        passwordEncrypted: 'encrypted-imap-secret',
        smtpHost: 'smtp.example.test',
        smtpPort: 465,
        smtpUsername: 'user@example.test',
        smtpPasswordEncrypted: 'encrypted-smtp-secret',
        isEnabled: true,
        syncStatus: 'idle',
        createdAt: now,
        updatedAt: now
      })
      .returning()
      .get();

    const input = AccountUpdateSchema.parse({
      email: 'new-user@example.test',
      host: 'imap2.example.test',
      port: 993,
      username: 'new-user@example.test',
      password: '',
      smtpHost: 'smtp2.example.test',
      smtpPort: 587,
      smtpUsername: 'new-user@example.test',
      smtpPassword: ''
    });

    const updated = await updateAccount(created.id, input);
    const stored = db.select().from(accounts).where(eq(accounts.id, created.id)).get();

    expect(updated?.email).toBe('new-user@example.test');
    expect(updated?.host).toBe('imap2.example.test');
    expect(stored?.passwordEncrypted).toBe('encrypted-imap-secret');
    expect(stored?.smtpPasswordEncrypted).toBe('encrypted-smtp-secret');
  });
});
