import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import type { Account, Message } from '../db/schema';
import { decryptSecret } from '../security';
import { sendSmtp } from './smtp';
import type { MailProvider, ProviderMessage } from './types';
import type { AddressObject } from 'mailparser';
import { env } from '../env';
import { getGoogleAccessToken } from '../oauth/google';

const mailboxOpChains = new Map<number, Promise<unknown>>();

async function withMailboxThrottle<T>(accountId: number, op: () => Promise<T>) {
  const prior = mailboxOpChains.get(accountId) || Promise.resolve();
  const next = prior
    .catch(() => undefined)
    .then(async () => {
      await new Promise((resolve) =>
        setTimeout(resolve, Math.max(0, env.MAILBOX_OP_MIN_INTERVAL_MS))
      );
      return op();
    });
  mailboxOpChains.set(accountId, next);
  try {
    return await next;
  } finally {
    if (mailboxOpChains.get(accountId) === next) mailboxOpChains.delete(accountId);
  }
}

async function clientFor(account: Account) {
  const accessToken = await getGoogleAccessToken(account);
  return new ImapFlow({
    host: account.host,
    port: account.port,
    secure: account.port === 993,
    auth: {
      user: account.username,
      ...(accessToken ? { accessToken } : { pass: decryptSecret(account.passwordEncrypted) })
    },
    logger: false
  });
}

export const imapEmailProvider: MailProvider = {
  async test(account) {
    const client = await clientFor(account);
    try {
      await client.connect();
      await client.logout();
      return { ok: true, message: 'IMAP connection succeeded' };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  },
  async listFolders(account) {
    const client = await clientFor(account);
    await client.connect();
    try {
      const boxes = await client.list();
      return boxes.map((box) => ({
        name: box.name,
        path: box.path,
        role: mapFolderRole(box.path, box.specialUse || null)
      }));
    } finally {
      await client.logout().catch(() => undefined);
    }
  },
  async backfill(account, limit = 100, folderPath = 'INBOX') {
    const client = await clientFor(account);
    await client.connect();
    const messages: ProviderMessage[] = [];
    try {
      const lock = await client.getMailboxLock(folderPath);
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
            providerMessageId: providerMessageId(folderPath, msg.uid),
            threadId: threadIdFor(
              parsed?.messageId || null,
              parsed?.inReplyTo || null,
              parsed?.references || null,
              parsed?.subject || msg.envelope?.subject || ''
            ),
            messageIdHeader: parsed?.messageId || null,
            inReplyTo: parsed?.inReplyTo || null,
            references: Array.isArray(parsed?.references)
              ? parsed.references.join(' ')
              : parsed?.references || null,
            folderPath,
            subject: parsed?.subject || msg.envelope?.subject || '(no subject)',
            from: addressText(parsed?.from),
            to: addressText(parsed?.to),
            cc: addressText(parsed?.cc) || null,
            bcc: addressText(parsed?.bcc) || null,
            date: (parsed?.date || msg.envelope?.date || new Date()).toISOString(),
            bodyText: parsed?.text || '',
            bodyHtml: typeof parsed?.html === 'string' ? parsed.html : null,
            attachments: mapAttachments(parsed?.attachments || []),
            isRead: msg.flags?.has('\\Seen') ?? false,
            isAnswered: msg.flags?.has('\\Answered') ?? false,
            isFlagged: msg.flags?.has('\\Flagged') ?? false
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
  async fetchSinceUid(account, folderPath, sinceUidExclusive, limit = 100) {
    const client = await clientFor(account);
    await client.connect();
    const messages: ProviderMessage[] = [];
    try {
      const lock = await client.getMailboxLock(folderPath);
      try {
        const mailbox = client.mailbox;
        const exists = mailbox && typeof mailbox === 'object' ? mailbox.exists : 0;
        if (exists <= 0) return messages;
        for await (const msg of client.fetch(`${sinceUidExclusive + 1}:*`, {
          uid: true,
          envelope: true,
          source: true,
          flags: true
        })) {
          const parsed = msg.source ? await simpleParser(msg.source) : null;
          messages.push({
            providerMessageId: providerMessageId(folderPath, msg.uid),
            threadId: threadIdFor(
              parsed?.messageId || null,
              parsed?.inReplyTo || null,
              parsed?.references || null,
              parsed?.subject || msg.envelope?.subject || ''
            ),
            messageIdHeader: parsed?.messageId || null,
            inReplyTo: parsed?.inReplyTo || null,
            references: Array.isArray(parsed?.references)
              ? parsed.references.join(' ')
              : parsed?.references || null,
            folderPath,
            subject: parsed?.subject || msg.envelope?.subject || '(no subject)',
            from: addressText(parsed?.from),
            to: addressText(parsed?.to),
            cc: addressText(parsed?.cc) || null,
            bcc: addressText(parsed?.bcc) || null,
            date: (parsed?.date || msg.envelope?.date || new Date()).toISOString(),
            bodyText: parsed?.text || '',
            bodyHtml: typeof parsed?.html === 'string' ? parsed.html : null,
            attachments: mapAttachments(parsed?.attachments || []),
            isRead: msg.flags?.has('\\Seen') ?? false,
            isAnswered: msg.flags?.has('\\Answered') ?? false,
            isFlagged: msg.flags?.has('\\Flagged') ?? false
          });
          if (messages.length >= limit) break;
        }
      } finally {
        lock.release();
      }
    } finally {
      await client.logout().catch(() => undefined);
    }
    return messages;
  },
  async folderState(account, folderPath) {
    const client = await clientFor(account);
    await client.connect();
    try {
      const status = await client.status(folderPath, {
        uidNext: true,
        uidValidity: true,
        messages: true
      });
      return {
        uidValidity: status.uidValidity ? String(status.uidValidity) : null,
        highestUid: Math.max(0, Number(status.uidNext || 1) - 1)
      };
    } finally {
      await client.logout().catch(() => undefined);
    }
  },
  async fetchAllUids(account, folderPath) {
    const client = await clientFor(account);
    await client.connect();
    try {
      const lock = await client.getMailboxLock(folderPath);
      try {
        const uids = await client.search({ all: true }, { uid: true });
        return Array.isArray(uids) ? uids.map(Number) : [];
      } finally {
        lock.release();
      }
    } finally {
      await client.logout().catch(() => undefined);
    }
  },
  async watchInbox(account, handlers, signal) {
    while (!signal.aborted) {
      const client = await clientFor(account);
      try {
        await client.connect();
        const lock = await client.getMailboxLock('INBOX');
        try {
          let known =
            client.mailbox && typeof client.mailbox === 'object' ? client.mailbox.exists : 0;
          while (!signal.aborted) {
            await client.idle();
            const current =
              client.mailbox && typeof client.mailbox === 'object' ? client.mailbox.exists : known;
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
                  providerMessageId: providerMessageId('INBOX', msg.uid),
                  threadId: threadIdFor(
                    parsed?.messageId || null,
                    parsed?.inReplyTo || null,
                    parsed?.references || null,
                    parsed?.subject || msg.envelope?.subject || ''
                  ),
                  messageIdHeader: parsed?.messageId || null,
                  inReplyTo: parsed?.inReplyTo || null,
                  references: Array.isArray(parsed?.references)
                    ? parsed.references.join(' ')
                    : parsed?.references || null,
                  folderPath: 'INBOX',
                  subject: parsed?.subject || msg.envelope?.subject || '(no subject)',
                  from: addressText(parsed?.from),
                  to: addressText(parsed?.to),
                  cc: addressText(parsed?.cc) || null,
                  bcc: addressText(parsed?.bcc) || null,
                  date: (parsed?.date || msg.envelope?.date || new Date()).toISOString(),
                  bodyText: parsed?.text || '',
                  bodyHtml: typeof parsed?.html === 'string' ? parsed.html : null,
                  attachments: mapAttachments(parsed?.attachments || []),
                  isRead: msg.flags?.has('\\Seen') ?? false,
                  isAnswered: msg.flags?.has('\\Answered') ?? false,
                  isFlagged: msg.flags?.has('\\Flagged') ?? false
                });
              }
            }
          }
        } finally {
          lock.release();
        }
      } catch (error) {
        if (!signal.aborted)
          handlers.onError(error instanceof Error ? error : new Error(String(error)));
      } finally {
        await client.logout().catch(() => undefined);
      }
      if (!signal.aborted) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }
  },
  async move(account: Account, message: Message, folderPath: string) {
    return withMailboxThrottle(account.id, async () => {
      const client = await clientFor(account);
      await client.connect();
      try {
        const lock = await client.getMailboxLock(message.folderPath);
        try {
          await client.messageMove(providerUid(message.providerMessageId), folderPath, {
            uid: true
          });
        } finally {
          lock.release();
        }
      } finally {
        await client.logout().catch(() => undefined);
      }
    });
  },
  async markAnswered(account: Account, message: Message) {
    return withMailboxThrottle(account.id, async () => {
      const client = await clientFor(account);
      await client.connect();
      try {
        const lock = await client.getMailboxLock(message.folderPath);
        try {
          await client.messageFlagsAdd(providerUid(message.providerMessageId), ['\\Answered'], {
            uid: true
          });
        } finally {
          lock.release();
        }
      } finally {
        await client.logout().catch(() => undefined);
      }
    });
  },
  async markRead(account: Account, message: Message, read: boolean) {
    return withMailboxThrottle(account.id, async () => {
      const client = await clientFor(account);
      await client.connect();
      try {
        const lock = await client.getMailboxLock(message.folderPath);
        try {
          if (read)
            await client.messageFlagsAdd(providerUid(message.providerMessageId), ['\\Seen'], {
              uid: true
            });
          else
            await client.messageFlagsRemove(providerUid(message.providerMessageId), ['\\Seen'], {
              uid: true
            });
        } finally {
          lock.release();
        }
      } finally {
        await client.logout().catch(() => undefined);
      }
    });
  },
  async setFlagged(account: Account, message: Message, flagged: boolean) {
    return withMailboxThrottle(account.id, async () => {
      const client = await clientFor(account);
      await client.connect();
      try {
        const lock = await client.getMailboxLock(message.folderPath);
        try {
          if (flagged)
            await client.messageFlagsAdd(providerUid(message.providerMessageId), ['\\Flagged'], {
              uid: true
            });
          else
            await client.messageFlagsRemove(providerUid(message.providerMessageId), ['\\Flagged'], {
              uid: true
            });
        } finally {
          lock.release();
        }
      } finally {
        await client.logout().catch(() => undefined);
      }
    });
  },
  async send(account, options) {
    return withMailboxThrottle(account.id, async () => {
      const sent = await sendSmtp(account, options);
      await appendToSentFolder(account, options).catch(() => undefined);
      return sent;
    });
  }
};

function addressText(value: AddressObject | AddressObject[] | undefined) {
  if (!value) return '';
  if (Array.isArray(value))
    return value
      .map((item) => item.text)
      .filter(Boolean)
      .join(', ');
  return value.text || '';
}

function threadIdFor(
  messageId: string | null,
  inReplyTo: string | null,
  references: string | string[] | null,
  subject: string
) {
  if (inReplyTo) return inReplyTo;
  if (Array.isArray(references) && references.length) return references[0];
  if (typeof references === 'string' && references.trim()) return references.trim().split(/\s+/)[0];
  return messageId || normalizeSubject(subject);
}

function normalizeSubject(subject: string) {
  return subject
    .toLowerCase()
    .replace(/^(re|fwd?):\s*/i, '')
    .trim();
}

function mapAttachments(
  attachments: Array<{
    filename?: string;
    contentType?: string;
    size?: number;
    cid?: string;
    contentDisposition?: string;
    content?: Buffer;
  }>
) {
  return attachments.map((attachment, index) => ({
    filename: attachment.filename || `attachment-${index + 1}`,
    contentType: attachment.contentType || 'application/octet-stream',
    sizeBytes: attachment.size || attachment.content?.length || 0,
    contentId: attachment.cid || null,
    disposition: attachment.contentDisposition || null,
    contentBase64: attachment.content ? attachment.content.toString('base64') : null
  }));
}

function providerMessageId(folderPath: string, uid: number | bigint | undefined) {
  return `${folderPath}:${String(uid ?? '')}`;
}

function providerUid(providerMessageIdValue: string) {
  const value = providerMessageIdValue.includes(':')
    ? providerMessageIdValue.split(':').at(-1)
    : providerMessageIdValue;
  return Number(value);
}

function mapFolderRole(path: string, specialUse: string | null) {
  const normalized = path.toLowerCase();
  const special = (specialUse || '').toLowerCase();
  if (special.includes('inbox') || normalized === 'inbox') return 'inbox';
  if (special.includes('archive') || normalized.includes('archive')) return 'archive';
  if (
    special.includes('junk') ||
    special.includes('spam') ||
    normalized.includes('spam') ||
    normalized.includes('junk')
  )
    return 'spam';
  if (special.includes('trash') || normalized.includes('trash') || normalized.includes('deleted'))
    return 'trash';
  if (special.includes('sent') || normalized.includes('sent')) return 'sent';
  if (special.includes('drafts') || normalized.includes('drafts')) return 'drafts';
  return specialUse || null;
}

async function appendToSentFolder(account: Account, options: Parameters<typeof sendSmtp>[1]) {
  const client = await clientFor(account);
  await client.connect();
  try {
    const sentFolder = await findSentFolder(client);
    if (!sentFolder) return;
    const raw = buildRfc822(account, options);
    await client.append(sentFolder, raw, ['\\Seen']);
  } finally {
    await client.logout().catch(() => undefined);
  }
}

async function findSentFolder(client: ImapFlow) {
  const boxes = await client.list();
  const bySpecial = boxes.find((box) =>
    (box.specialUse || '').toLowerCase().includes('sent')
  )?.path;
  if (bySpecial) return bySpecial;
  return boxes.find((box) => box.path.toLowerCase().includes('sent'))?.path ?? null;
}

function buildRfc822(account: Account, options: Parameters<typeof sendSmtp>[1]) {
  const headers = [
    `From: ${account.email}`,
    `To: ${options.to}`,
    options.cc ? `Cc: ${options.cc}` : null,
    options.bcc ? `Bcc: ${options.bcc}` : null,
    `Subject: ${options.subject}`,
    options.inReplyTo ? `In-Reply-To: ${options.inReplyTo}` : null,
    options.references ? `References: ${options.references}` : null,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    options.text || ''
  ]
    .filter(Boolean)
    .join('\r\n');
  return Buffer.from(headers, 'utf8');
}
