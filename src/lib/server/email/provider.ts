import type { Account } from '../db/schema';
import { imapEmailProvider } from './imap';
import { mockEmailProvider } from './mock';
import type { MailProvider } from './types';

export function providerForAccount(account: Account): MailProvider {
  if (account.host === 'mock' || account.smtpHost === 'mock') return mockEmailProvider;
  return imapEmailProvider;
}
