import crypto from 'node:crypto';
import { env, isProduction } from './env';

const devKey = 'development-only-temporary-dear-robot-key';

function encryptionKey() {
  return crypto
    .createHash('sha256')
    .update(env.ENCRYPTION_KEY || devKey)
    .digest();
}

export function encryptSecret(value: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${tag.toString('base64')}.${encrypted.toString('base64')}`;
}

export function decryptSecret(value: string | null | undefined) {
  if (!value) return '';
  const [ivRaw, tagRaw, encryptedRaw] = value.split('.');
  if (!ivRaw || !tagRaw || !encryptedRaw) return '';
  try {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      encryptionKey(),
      Buffer.from(ivRaw, 'base64')
    );
    decipher.setAuthTag(Buffer.from(tagRaw, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedRaw, 'base64')),
      decipher.final()
    ]).toString('utf8');
  } catch (err) {
    console.error(
      '[dear-robot] Decryption failed. This usually means ENCRYPTION_KEY has changed.',
      {
        error: err instanceof Error ? err.message : String(err)
      }
    );
    return '';
  }
}

export function sessionCookieValue() {
  const secret = env.APP_SESSION_SECRET || 'dev-session-secret';
  return crypto.createHmac('sha256', secret).update('dear-robot-authenticated').digest('base64url');
}

export function isValidSession(value: string | undefined) {
  return Boolean(value && value === sessionCookieValue());
}

export function csrfToken(sessionValue: string | undefined) {
  const secret = env.APP_SESSION_SECRET || 'dev-session-secret';
  return crypto
    .createHmac('sha256', secret)
    .update(sessionValue || 'anonymous')
    .digest('base64url');
}

export function sameOriginOrForm(headers: Headers) {
  const origin = headers.get('origin');
  const host = headers.get('host');
  if (!origin || !host) return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

type BrowserBridgeCapability = {
  version: 1;
  runId: number;
  sessionId: string;
  appOrigin: string;
  expiresAt: number;
};

const browserBridgeTokenLifetimeMs = 5 * 60 * 1000;

function canonicalHttpOrigin(value: string) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== value) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function browserBridgeSignature(payload: string) {
  const secret = env.APP_SESSION_SECRET || 'dev-session-secret';
  return crypto
    .createHmac('sha256', secret)
    .update(`browser-bridge:${payload}`)
    .digest('base64url');
}

/**
 * Issue a short-lived capability for the installed browser extension. The
 * extension verifies it with this server before it opens a recording tab, so
 * arbitrary webpages that happen to have the content script cannot pose as
 * Dear Robot.
 */
export function issueBrowserBridgeCapability(input: {
  runId: number;
  sessionId: string;
  appOrigin: string;
}) {
  const appOrigin = canonicalHttpOrigin(input.appOrigin);
  if (!Number.isInteger(input.runId) || input.runId <= 0 || !appOrigin) {
    throw new Error('Could not create a secure browser bridge session.');
  }
  if (!/^[a-zA-Z0-9_-]{12,160}$/.test(input.sessionId)) {
    throw new Error('Could not create a secure browser bridge session.');
  }
  const capability: BrowserBridgeCapability = {
    version: 1,
    runId: input.runId,
    sessionId: input.sessionId,
    appOrigin,
    expiresAt: Date.now() + browserBridgeTokenLifetimeMs
  };
  const payload = Buffer.from(JSON.stringify(capability)).toString('base64url');
  return `${payload}.${browserBridgeSignature(payload)}`;
}

export function verifyBrowserBridgeCapability(
  token: string,
  expected: { sessionId: string; appOrigin: string }
) {
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra || token.length > 2000) return null;
  const expectedSignature = browserBridgeSignature(payload);
  const supplied = Buffer.from(signature);
  const trusted = Buffer.from(expectedSignature);
  if (supplied.length !== trusted.length || !crypto.timingSafeEqual(supplied, trusted)) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8')
    ) as BrowserBridgeCapability;
    const appOrigin = canonicalHttpOrigin(parsed.appOrigin);
    if (
      parsed.version !== 1 ||
      !Number.isInteger(parsed.runId) ||
      parsed.runId <= 0 ||
      typeof parsed.sessionId !== 'string' ||
      !/^[a-zA-Z0-9_-]{12,160}$/.test(parsed.sessionId) ||
      !appOrigin ||
      parsed.expiresAt < Date.now() ||
      parsed.expiresAt > Date.now() + browserBridgeTokenLifetimeMs + 10_000 ||
      parsed.sessionId !== expected.sessionId ||
      appOrigin !== expected.appOrigin
    ) {
      return null;
    }
    return { runId: parsed.runId, sessionId: parsed.sessionId, appOrigin };
  } catch {
    return null;
  }
}

export function requireConfiguredPassword() {
  if (!env.APP_PASSWORD && isProduction) {
    throw new Error('APP_PASSWORD is required in production');
  }
}

export function signWebhookPayload(payload: string, secret: string) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}
