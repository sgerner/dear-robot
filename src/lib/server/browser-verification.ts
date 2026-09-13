/** Only extract fresh codes addressed to the configured login from the allowed service. */
export function verificationCodeFromMessage(
  message: { from: string; to: string; subject: string; bodyText: string; date: string },
  input: { email: string; hosts: string[]; since: number }
) {
  const addresses = (value: string): string[] =>
    value.toLowerCase().match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+/g) || [];
  const date = Date.parse(message.date);
  if (!Number.isFinite(date) || date < input.since || date > Date.now() + 60000) return null;
  if (!addresses(message.to).includes(input.email.toLowerCase())) return null;
  const sender = addresses(message.from);
  if (sender.length !== 1) return null;
  const domain = sender[0].split('@')[1];
  if (!input.hosts.some((host) => domain === host || domain.endsWith(`.${host}`))) return null;
  const text = `${message.subject}\n${message.bodyText}`.replace(/\u00a0/g, ' ');
  if (
    !/(verification|security|one.time|sign.in|log.in|authentication|verify).*code|code.*(verification|sign.in|log.in)/is.test(
      text
    )
  )
    return null;
  // Prefer the value actually labelled as a code. Copyright years and phone
  // numbers in a footer must not make otherwise clear verification mail fail.
  const labelled = [
    ...text.matchAll(
      /(?:verification|security|one[ -]time|sign[ -]in|log[ -]in|authentication|verify)?\s*code(?:\s+(?:is|below|to\s+(?:log|sign)\s*in))?\s*[:.-]?\s*(\d{4,8})\b/gi
    )
  ].map((match) => match[1]);
  const codes = [...new Set(labelled.length ? labelled : text.match(/\b\d{4,8}\b/g) || [])];
  if (
    codes.length === 1 &&
    (text.match(/\b\d{4,8}\b/g) || []).some(
      (candidate) => candidate.length === codes[0].length && candidate !== codes[0]
    )
  )
    return null;
  return codes.length === 1 ? codes[0] : null;
}

/** Read only the source mailbox and the enabled account matching the login. */
export async function waitForInboxVerification(input: {
  sourceAccountId: number;
  email: string;
  hosts: string[];
  since: number;
  timeoutMs?: number;
  isCancelled: () => boolean;
}) {
  const [{ db }, { accounts, messages }, { and, desc, eq, gte, inArray }, { syncAccount }] =
    await Promise.all([
      import('./db'),
      import('./db/schema'),
      import('drizzle-orm'),
      import('./sync')
    ]);
  const enabled = db
    .select({ id: accounts.id, email: accounts.email })
    .from(accounts)
    .where(eq(accounts.isEnabled, true))
    .all();
  const mailboxIds = enabled
    .filter(
      (account) =>
        account.id === input.sourceAccountId ||
        account.email.toLowerCase() === input.email.toLowerCase()
    )
    .map((account) => account.id);
  if (!mailboxIds.length)
    throw new Error(
      'No enabled inbox is available for this login. Connect the verification email account and try again.'
    );
  const deadline = Date.now() + (input.timeoutMs ?? 120000);
  let nextSync = 0;
  while (Date.now() < deadline) {
    if (input.isCancelled()) throw new Error('Browser run cancelled');
    if (Date.now() >= nextSync) {
      nextSync = Date.now() + 15000;
      for (const id of mailboxIds) void syncAccount(id).catch(() => undefined);
    }
    const recent = db
      .select()
      .from(messages)
      .where(
        and(
          inArray(messages.accountId, mailboxIds),
          gte(messages.date, new Date(input.since).toISOString())
        )
      )
      .orderBy(desc(messages.date))
      .limit(50)
      .all();
    for (const message of recent) {
      const code = verificationCodeFromMessage(message, input);
      if (code) return code;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(
    'No fresh verification email arrived within two minutes. Check the login address and mailbox sync. SMS, authenticator codes and CAPTCHA need your help.'
  );
}
