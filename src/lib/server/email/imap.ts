import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import type { Account, Message } from '../db/schema';
import { decryptSecret } from '../security';
import { sendSmtp } from './smtp';
import type { MailProvider, ProviderMessage } from './types';
import type { AddressObject } from 'mailparser';

function clientFor(account: Account) {
  return new ImapFlow({
    host: account.host,
    port: account.port,
    secure: account.port === 993,
    auth: {
      user: account.username,
      pass: decryptSecret(account.passwordEncrypted)
    },
    logger: false
  });
}

export const imapEmailProvider: MailProvider = {
  async test(account) {
    const client = clientFor(account);
    try {
      await client.connect();
      await client.logout();
      return { ok: true, message: 'IMAP connection succeeded' };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  },
  async listFolders(account) {
    const client = clientFor(account);
    await client.connect();
    try {
      const boxes = await client.list();
      return boxes.map((box) => ({
        name: box.name,
        path: box.path,
        role: box.specialUse || null
      }));
    } finally {
      await client.logout().catch(() => undefined);
    }
  },
  async backfill(account, limit = 100) {
    const client = clientFor(account);
    await client.connect();
    const messages: ProviderMessage[] = [];
    try {
      const lock = await client.getMailboxLock('INBOX');
      try {
        const mailbox = client.mailbox;
        const exists = mailbox && typeof mailbox === 'object' ? mailbox.exists : 0;
        const start = Math.max(1, exists - limit + 1);
        for await (const msg of client.fetch(`${start}:*`, {
          uid: true,
          envelope: true,
          source: true,
          flags: true
        })) {
          const parsed = msg.source ? await simpleParser(msg.source) : null;
          messages.push({
            providerMessageId: String(msg.uid),
            threadId: parsed?.messageId || null,
            folderPath: 'INBOX',
            subject: parsed?.subject || msg.envelope?.subject || '(no subject)',
            from: addressText(parsed?.from),
            to: addressText(parsed?.to),
            cc: addressText(parsed?.cc) || null,
            date: (parsed?.date || msg.envelope?.date || new Date()).toISOString(),
            bodyText: parsed?.text || '',
            bodyHtml: typeof parsed?.html === 'string' ? parsed.html : null,
            isRead: msg.flags?.has('\\Seen') ?? false,
            isAnswered: msg.flags?.has('\\Answered') ?? false
          });
        }
      } finally {
        lock.release();
      }
    } finally {
      await client.logout().catch(() => undefined);
    }
    return messages;
  },
  async watchInbox(account, handlers, signal) {
    while (!signal.aborted) {
      const client = clientFor(account);
      try {
        await client.connect();
        const lock = await client.getMailboxLock('INBOX');
        try {
          let known = client.mailbox && typeof client.mailbox === 'object' ? client.mailbox.exists : 0;
          while (!signal.aborted) {
            await client.idle();
            const current = client.mailbox && typeof client.mailbox === 'object' ? client.mailbox.exists : known;
            if (current > known) {
              const start = known + 1;
              known = current;
              for await (const msg of client.fetch(`${start}:*`, {
                uid: true,
                envelope: true,
                source: true,
                flags: true
              })) {
                const parsed = msg.source ? await simpleParser(msg.source) : null;
                await handlers.onMessage({
                  providerMessageId: String(msg.uid),
                  threadId: parsed?.messageId || null,
                  folderPath: 'INBOX',
                  subject: parsed?.subject || msg.envelope?.subject || '(no subject)',
                  from: addressText(parsed?.from),
                  to: addressText(parsed?.to),
                  cc: addressText(parsed?.cc) || null,
                  date: (parsed?.date || msg.envelope?.date || new Date()).toISOString(),
                  bodyText: parsed?.text || '',
                  bodyHtml: typeof parsed?.html === 'string' ? parsed.html : null,
                  isRead: msg.flags?.has('\\Seen') ?? false,
                  isAnswered: msg.flags?.has('\\Answered') ?? false
                });
              }
            }
          }
        } finally {
          lock.release();
        }
      } catch (error) {
        if (!signal.aborted) handlers.onError(error instanceof Error ? error : new Error(String(error)));
      } finally {
        await client.logout().catch(() => undefined);
      }
      if (!signal.aborted) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }
  },
  async move(account: Account, message: Message, folderPath: string) {
    const client = clientFor(account);
    await client.connect();
    try {
      const lock = await client.getMailboxLock(message.folderPath);
      try {
        await client.messageMove(Number(message.providerMessageId), folderPath, { uid: true });
      } finally {
        lock.release();
      }
    } finally {
      await client.logout().catch(() => undefined);
    }
  },
  async markAnswered(account: Account, message: Message) {
    const client = clientFor(account);
    await client.connect();
    try {
      const lock = await client.getMailboxLock(message.folderPath);
      try {
        await client.messageFlagsAdd(Number(message.providerMessageId), ['\\Answered'], { uid: true });
      } finally {
        lock.release();
      }
    } finally {
      await client.logout().catch(() => undefined);
    }
  },
  async send(account, options) {
    return sendSmtp(account, options);
  }
};

function addressText(value: AddressObject | AddressObject[] | undefined) {
  if (!value) return '';
  if (Array.isArray(value)) return value.map((item) => item.text).filter(Boolean).join(', ');
  return value.text || '';
}
