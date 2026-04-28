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
  async backfill(_account, limit = 100) {
    return readFixtureEmails().slice(0, limit).map(
      (email): ProviderMessage => ({
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
        isAnswered: false
      })
    );
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
  async send(account: Account, options) {
    const messageId = `mock-sent-${Date.now()}-${mockActions.length}`;
    mockActions.push({ type: 'send', accountId: account.id, messageId, ...options });
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
  return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'tests/fixtures/emails.json'), 'utf8'));
}
