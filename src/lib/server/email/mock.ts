import fs from 'node:fs';
import path from 'node:path';
import type { Account, Message } from '../db/schema';
import type { MailProvider, ProviderMessage } from './types';

const mockActions: Array<Record<string, unknown>> = [];

export function recordedMockActions() {
  return mockActions;
}

export function clearMockActions() {
  mockActions.length = 0;
}

export const mockEmailProvider: MailProvider = {
  async test() {
    return { ok: true, message: 'Mock account is ready' };
  },
  async listFolders() {
    return [
      { name: 'INBOX', path: 'INBOX', role: 'inbox' },
      { name: 'Newsletters', path: 'Newsletters', role: 'newsletters' },
      { name: 'Receipts', path: 'Receipts', role: 'receipts' },
      { name: 'Spam Review', path: 'Spam Review', role: 'spam' },
      { name: 'Archive', path: 'Archive', role: 'archive' },
      { name: 'Trash', path: 'Trash', role: 'trash' }
    ];
  },
  async backfill(_account, limit = 100, folderPath = 'INBOX') {
    if (folderPath !== 'INBOX') return [];
    return readFixtureEmails()
      .slice(0, limit)
      .map(
        (email): ProviderMessage => ({
          providerMessageId: `${folderPath}:${email.id}`,
          threadId: email.thread_id ?? null,
          messageIdHeader: `<${email.id}@fixtures.dear-robot.local>`,
          inReplyTo: null,
          references: null,
          folderPath,
          subject: email.subject,
          from: email.from,
          to: email.to,
          cc: email.cc ?? null,
          bcc: null,
          date: email.date,
          bodyText: email.body_text,
          bodyHtml: null,
          attachments: [
            {
              filename: 'note.txt',
              contentType: 'text/plain',
              sizeBytes: 18,
              contentId: null,
              disposition: 'attachment',
              contentBase64: Buffer.from('fixture attachment', 'utf8').toString('base64')
            }
          ],
          isRead: false,
          isAnswered: false,
          isFlagged: false
        })
      );
  },
  async fetchSinceUid(_account, folderPath, sinceUidExclusive, limit = 100) {
    if (folderPath !== 'INBOX') return [];
    const emails = readFixtureEmails();
    return emails
      .map((email, index) => ({ email, uid: index + 1 }))
      .filter((row) => row.uid > sinceUidExclusive)
      .slice(0, limit)
      .map(
        ({ email }): ProviderMessage => ({
          providerMessageId: `${folderPath}:${email.id}`,
          threadId: email.thread_id ?? null,
          messageIdHeader: `<${email.id}@fixtures.dear-robot.local>`,
          inReplyTo: null,
          references: null,
          folderPath,
          subject: email.subject,
          from: email.from,
          to: email.to,
          cc: email.cc ?? null,
          bcc: null,
          date: email.date,
          bodyText: email.body_text,
          bodyHtml: null,
          attachments: [
            {
              filename: 'note.txt',
              contentType: 'text/plain',
              sizeBytes: 18,
              contentId: null,
              disposition: 'attachment',
              contentBase64: Buffer.from('fixture attachment', 'utf8').toString('base64')
            }
          ],
          isRead: false,
          isAnswered: false,
          isFlagged: false
        })
      );
  },
  async folderState(_account, folderPath) {
    if (folderPath !== 'INBOX') return { uidValidity: 'mock-static', highestUid: 0 };
    return { uidValidity: 'mock-static', highestUid: readFixtureEmails().length };
  },
  async watchInbox(_account, _handlers, signal) {
    while (!signal.aborted) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  },
  async move(account: Account, message: Message, folderPath: string) {
    mockActions.push({ type: 'move', accountId: account.id, messageId: message.id, folderPath });
  },
  async markAnswered(account: Account, message: Message) {
    mockActions.push({ type: 'mark_answered', accountId: account.id, messageId: message.id });
  },
  async markRead(account: Account, message: Message, read: boolean) {
    mockActions.push({ type: 'mark_read', accountId: account.id, messageId: message.id, read });
  },
  async setFlagged(account: Account, message: Message, flagged: boolean) {
    mockActions.push({
      type: 'set_flagged',
      accountId: account.id,
      messageId: message.id,
      flagged
    });
  },
  async send(account: Account, options) {
    const messageId = `mock-sent-${Date.now()}-${mockActions.length}`;
    mockActions.push({ type: 'send', accountId: account.id, messageId, ...options });
    mockActions.push({ type: 'append_sent', accountId: account.id, messageId });
    return { messageId };
  }
};

function readFixtureEmails(): Array<{
  id: string;
  thread_id?: string | null;
  subject: string;
  from: string;
  to: string;
  cc?: string | null;
  date: string;
  body_text: string;
}> {
  return JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'tests/fixtures/emails.json'), 'utf8')
  );
}
