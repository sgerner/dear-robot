import type { Account, Message } from '../db/schema';

export type ProviderMessage = {
  providerMessageId: string;
  threadId?: string | null;
  folderPath: string;
  subject: string;
  from: string;
  to: string;
  cc?: string | null;
  date: string;
  bodyText: string;
  bodyHtml?: string | null;
  isRead: boolean;
  isAnswered: boolean;
};

export type MailProvider = {
  test(account: Account): Promise<{ ok: boolean; message: string }>;
  listFolders(account: Account): Promise<Array<{ name: string; path: string; role?: string | null }>>;
  backfill(account: Account, limit?: number): Promise<ProviderMessage[]>;
  watchInbox(
    account: Account,
    handlers: {
      onMessage: (message: ProviderMessage) => Promise<void>;
      onError: (error: Error) => void;
    },
    signal: AbortSignal
  ): Promise<void>;
  move(account: Account, message: Message, folderPath: string): Promise<void>;
  markAnswered(account: Account, message: Message): Promise<void>;
  send(account: Account, options: { to: string; subject: string; text: string; inReplyTo?: string | null }): Promise<{ messageId: string }>;
};
