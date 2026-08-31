import { beforeEach, describe, expect, it, vi } from 'vitest';

const imapState = vi.hoisted(() => {
  const clients: Array<{
    mailbox: { exists: number };
    lockRelease: ReturnType<typeof vi.fn>;
    connected: boolean;
    loggedOut: boolean;
    idleCalls: number;
  }> = [];

  return {
    clients,
    clear() {
      clients.length = 0;
    }
  };
});

vi.mock('imapflow', () => {
  class FakeImapFlow {
    mailbox = { exists: 2 };
    lockRelease = vi.fn();
    connected = false;
    loggedOut = false;
    idleCalls = 0;

    constructor(_options: unknown) {
      imapState.clients.push(this);
    }

    async connect() {
      this.connected = true;
    }

    async getMailboxLock() {
      return {
        release: this.lockRelease
      };
    }

    async idle() {
      this.idleCalls += 1;
      this.mailbox.exists = 1;
    }

    async fetch() {
      return {
        async *[Symbol.asyncIterator]() {
          // No new messages needed for this regression.
        }
      };
    }

    async logout() {
      this.loggedOut = true;
    }
  }

  return { ImapFlow: FakeImapFlow };
});

vi.mock('../src/lib/server/oauth/google', () => ({
  getGoogleAccessToken: vi.fn(async () => null)
}));

vi.mock('../src/lib/server/security', () => ({
  decryptSecret: vi.fn(() => 'mock-password')
}));

beforeEach(async () => {
  process.env.NODE_ENV = 'test';
  process.env.APP_PASSWORD = 'test-password';
  process.env.APP_SESSION_SECRET = 'test-session-secret-that-is-long-enough';
  process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef';
  imapState.clear();
  vi.resetModules();
});

describe('IMAP watch loop', () => {
  it('requests a reconciliation when the watched mailbox shrinks', async () => {
    const { imapEmailProvider } = await import('../src/lib/server/email/imap');

    const account = {
      id: 1,
      email: 'user@example.test',
      host: 'imap.example.test',
      port: 993,
      username: 'user@example.test',
      passwordEncrypted: 'encrypted',
      smtpHost: 'smtp.example.test',
      smtpPort: 465,
      smtpUsername: 'user@example.test',
      smtpPasswordEncrypted: 'encrypted',
      authType: 'password' as const
    } as unknown as Parameters<typeof imapEmailProvider.watchInbox>[0];

    const controller = new AbortController();
    const mailboxChanged = vi.fn(async () => {
      controller.abort();
    });
    const onError = vi.fn();
    const onMessage = vi.fn();

    await imapEmailProvider.watchInbox(
      account,
      {
        onMessage,
        onMailboxChanged: mailboxChanged,
        onError
      },
      controller.signal
    );

    expect(mailboxChanged).toHaveBeenCalledTimes(1);
    expect(mailboxChanged).toHaveBeenCalledWith({
      folderPath: 'INBOX',
      previousCount: 2,
      currentCount: 1
    });
    expect(onMessage).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(imapState.clients).toHaveLength(1);
    expect(imapState.clients[0]?.connected).toBe(true);
    expect(imapState.clients[0]?.loggedOut).toBe(true);
    expect(imapState.clients[0]?.lockRelease).toHaveBeenCalled();
  });
});
