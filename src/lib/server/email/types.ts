import type { Account, Message } from '../db/schema';

export type ProviderMessage = {
  providerMessageId: string;
  threadId?: string | null;
  messageIdHeader?: string | null;
  inReplyTo?: string | null;
  references?: string | null;
  folderPath: string;
  subject: string;
  from: string;
  to: string;
  cc?: string | null;
  bcc?: string | null;
  date: string;
  bodyText: string;
  bodyHtml?: string | null;
  attachments?: Array<{
    filename: string;
    contentType: string;
    sizeBytes: number;
    contentId?: string | null;
    disposition?: string | null;
    contentBase64?: string | null;
  }>;
  isRead: boolean;
  isAnswered: boolean;
  isFlagged: boolean;
};

export type SendMailOptions = {
  to: string;
  cc?: string | null;
  bcc?: string | null;
  subject: string;
  text: string;
  html?: string | null;
  inReplyTo?: string | null;
  references?: string | null;
  attachments?: Array<{
    filename: string;
    contentType?: string | null;
    contentBase64: string;
  }>;
};

export type MailProvider = {
  test(account: Account): Promise<{ ok: boolean; message: string }>;
  listFolders(account: Account): Promise<Array<{ name: string; path: string; role?: string | null }>>;
  backfill(account: Account, limit?: number, folderPath?: string): Promise<ProviderMessage[]>;
  fetchSinceUid?(
    account: Account,
    folderPath: string,
    sinceUidExclusive: number,
    limit?: number
  ): Promise<ProviderMessage[]>;
  folderState?(
    account: Account,
    folderPath: string
  ): Promise<{
    uidValidity: string | null;
    highestUid: number;
  }>;
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
  markRead(account: Account, message: Message, read: boolean): Promise<void>;
  setFlagged(account: Account, message: Message, flagged: boolean): Promise<void>;
  send(account: Account, options: SendMailOptions): Promise<{ messageId: string }>;
};
