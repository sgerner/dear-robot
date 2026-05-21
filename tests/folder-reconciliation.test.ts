import { beforeEach, describe, expect, it, vi } from 'vitest';

const remoteCounts = vi.hoisted(() => ({
  values: { INBOX: 3, Archive: 2 }
}));

vi.mock('../src/lib/server/email/provider', () => ({
  providerForAccount: vi.fn(() => ({
    folderState: vi.fn(async (_account, folderPath: string) => {
      const count = remoteCounts.values[folderPath as keyof typeof remoteCounts.values] ?? 0;
      return {
        uidValidity: 'mock-static',
        highestUid: count,
        messageCount: count
      };
    })
  }))
}));

beforeEach(async () => {
  process.env.NODE_ENV = 'test';
  process.env.DB_PATH = ':memory:';
  process.env.APP_PASSWORD = 'test-password';
  process.env.APP_SESSION_SECRET = 'test-session-secret-that-is-long-enough';
  process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef';
  const { resetForTests } = await import('../src/lib/server/db/bootstrap');
  resetForTests();
  remoteCounts.values = { INBOX: 3, Archive: 2 };
  vi.resetModules();
});

describe('remote folder reconciliation', () => {
  it('detects remote changes in folders other than INBOX', async () => {
    const { db, nowIso } = await import('../src/lib/server/db');
    const { accounts, folders } = await import('../src/lib/server/db/schema');
    const { detectRemoteFolderChanges } = await import('../src/lib/server/sync');

    const now = nowIso();
    const account = db
      .insert(accounts)
      .values({
        email: 'user@example.test',
        host: 'imap.example.test',
        port: 993,
        username: 'user@example.test',
        passwordEncrypted: 'encrypted',
        smtpHost: 'smtp.example.test',
        smtpPort: 465,
        smtpUsername: 'user@example.test',
        smtpPasswordEncrypted: 'encrypted',
        isEnabled: true,
        syncStatus: 'idle',
        createdAt: now,
        updatedAt: now
      })
      .returning()
      .get();

    db.insert(folders)
      .values([
        {
          accountId: account.id,
          name: 'INBOX',
          path: 'INBOX',
          role: 'inbox',
          createdAt: now,
          updatedAt: now
        },
        {
          accountId: account.id,
          name: 'Archive',
          path: 'Archive',
          role: 'archive',
          createdAt: now,
          updatedAt: now
        }
      ])
      .run();

    expect(await detectRemoteFolderChanges(account.id)).toBe(false);

    remoteCounts.values.Archive = 1;

    expect(await detectRemoteFolderChanges(account.id)).toBe(true);
  });
});
