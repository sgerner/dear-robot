import { describe, expect, it } from 'vitest';

const enabled = process.env.RUN_LIVE_PROVIDER_TESTS === 'true';
const suite = enabled ? describe : describe.skip;

suite('live provider integration (gated)', () => {
  it('connects to IMAP and lists folders with real credentials', async () => {
    const required = [
      process.env.IMAP_HOST,
      process.env.IMAP_USERNAME,
      process.env.IMAP_PASSWORD,
      process.env.SMTP_HOST,
      process.env.SMTP_USERNAME,
      process.env.SMTP_PASSWORD
    ];
    if (required.some((value) => !value)) throw new Error('Live provider test env vars are incomplete');
    const { encryptSecret } = await import('../src/lib/server/security');
    const { imapEmailProvider } = await import('../src/lib/server/email/imap');
    const account = {
      id: 999999,
      email: process.env.IMAP_USERNAME || 'live@test',
      host: process.env.IMAP_HOST || '',
      port: Number(process.env.IMAP_PORT || 993),
      username: process.env.IMAP_USERNAME || '',
      passwordEncrypted: encryptSecret(process.env.IMAP_PASSWORD || ''),
      smtpHost: process.env.SMTP_HOST || '',
      smtpPort: Number(process.env.SMTP_PORT || 465),
      smtpUsername: process.env.SMTP_USERNAME || '',
      smtpPasswordEncrypted: encryptSecret(process.env.SMTP_PASSWORD || ''),
      authType: 'password' as const,
      oauthProvider: null,
      oauthAccessTokenEncrypted: null,
      oauthRefreshTokenEncrypted: null,
      oauthAccessTokenExpiresAt: null,
      isEnabled: true,
      lastSyncAt: null,
      syncStatus: 'idle' as const,
      syncError: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const test = await imapEmailProvider.test(account);
    expect(test.ok).toBe(true);
    const folders = await imapEmailProvider.listFolders(account);
    expect(folders.length).toBeGreaterThan(0);
  });
});
