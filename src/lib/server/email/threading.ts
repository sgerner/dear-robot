export type ThreadableMessage = {
  id: number;
  accountId: number;
  messageIdHeader?: string | null;
  inReplyTo?: string | null;
  references?: string | null;
  threadId?: string | null;
};

export function parseThreadReferences(references: string | string[] | null | undefined) {
  if (!references) return [];
  if (Array.isArray(references)) {
    return references.map((reference) => reference.trim()).filter(Boolean);
  }
  return references
    .split(/\s+/)
    .map((reference) => reference.trim())
    .filter(Boolean);
}

export function threadKeyCandidateFromHeaders(message: {
  messageIdHeader?: string | null;
  inReplyTo?: string | null;
  references?: string | string[] | null;
  threadId?: string | null;
}) {
  return (
    parseThreadReferences(message.references)[0] ||
    trimThreadValue(message.inReplyTo) ||
    trimThreadValue(message.threadId) ||
    trimThreadValue(message.messageIdHeader) ||
    null
  );
}

export function buildReplyReferences(options: {
  references?: string | string[] | null;
  messageIdHeader?: string | null;
  threadId?: string | null;
}) {
  const chain = parseThreadReferences(options.references);
  const current =
    trimThreadValue(options.messageIdHeader) || trimThreadValue(options.threadId) || null;
  if (!chain.length) return current;
  if (!current) return chain.join(' ');
  return [...chain, current].join(' ');
}

export function buildConversationKeyResolver(messages: ThreadableMessage[]) {
  const byHeader = new Map<string, ThreadableMessage>();
  for (const message of messages) {
    const header = trimThreadValue(message.messageIdHeader);
    if (header) byHeader.set(header, message);
  }

  const memo = new Map<number, string>();
  const visiting = new Set<number>();

  function resolve(message: ThreadableMessage): string {
    const cached = memo.get(message.id);
    if (cached) return cached;
    if (visiting.has(message.id)) {
      return fallbackConversationKey(message);
    }

    visiting.add(message.id);
    const candidate = threadKeyCandidateFromHeaders(message);
    let key = fallbackConversationKey(message);
    if (candidate) {
      const parent = byHeader.get(candidate);
      if (parent && parent.id !== message.id) {
        key = resolve(parent);
      } else {
        key = candidate;
      }
    }
    memo.set(message.id, key);
    visiting.delete(message.id);
    return key;
  }

  return resolve;
}

export function fallbackConversationKey(message: ThreadableMessage) {
  return trimThreadValue(message.messageIdHeader) || trimThreadValue(message.threadId) || `message:${message.id}`;
}

export function duplicateDeliveryKey(message: {
  messageIdHeader?: string | null;
  subject?: string | null;
  from?: string | null;
  bodyText?: string | null;
}) {
  const header = trimThreadValue(message.messageIdHeader);
  if (header) return `mid:${header.toLowerCase()}`;
  const subject = normalizeInlineText(message.subject);
  const sender = normalizeInlineText(message.from);
  const body = normalizeInlineText((message.bodyText || '').slice(0, 400));
  return `fallback:${sender}|${subject}|${body}`;
}

function trimThreadValue(value: string | null | undefined) {
  return value?.trim() || null;
}

function normalizeInlineText(value: string | null | undefined) {
  return (value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
