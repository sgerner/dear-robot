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
    console.error('[dear-robot] Decryption failed. This usually means ENCRYPTION_KEY has changed.', {
      error: err instanceof Error ? err.message : String(err)
    });
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

export function requireConfiguredPassword() {
  if (!env.APP_PASSWORD && isProduction) {
    throw new Error('APP_PASSWORD is required in production');
  }
}

export function signWebhookPayload(payload: string, secret: string) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}
