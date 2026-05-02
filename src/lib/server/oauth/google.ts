import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, nowIso } from '$lib/server/db';
import { accounts, oauthProviders } from '$lib/server/db/schema';
import { decryptSecret, encryptSecret } from '$lib/server/security';

const GOOGLE_DEFAULT_SCOPES = ['openid', 'email', 'profile', 'https://mail.google.com/'];

export const GoogleOauthSettingsSchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  redirectUri: z.string().url(),
  scopes: z.array(z.string().min(1)).min(1).default(GOOGLE_DEFAULT_SCOPES),
  isEnabled: z.boolean().default(true)
});

export function getGoogleOauthSettings() {
  const row = db.select().from(oauthProviders).where(eq(oauthProviders.provider, 'google')).get();
  if (!row) return null;
  return {
    provider: row.provider,
    clientId: row.clientId,
    redirectUri: row.redirectUri,
    scopes: parseScopes(row.scopes),
    isEnabled: row.isEnabled,
    hasClientSecret: Boolean(row.clientSecretEncrypted),
    updatedAt: row.updatedAt
  };
}

export function upsertGoogleOauthSettings(input: z.infer<typeof GoogleOauthSettingsSchema>) {
  const now = nowIso();
  const saved = db
    .insert(oauthProviders)
    .values({
      provider: 'google',
      clientId: input.clientId,
      clientSecretEncrypted: encryptSecret(input.clientSecret),
      redirectUri: input.redirectUri,
      scopes: JSON.stringify(input.scopes),
      isEnabled: input.isEnabled,
      createdAt: now,
      updatedAt: now
    })
    .onConflictDoUpdate({
      target: oauthProviders.provider,
      set: {
        clientId: input.clientId,
        clientSecretEncrypted: encryptSecret(input.clientSecret),
        redirectUri: input.redirectUri,
        scopes: JSON.stringify(input.scopes),
        isEnabled: input.isEnabled,
        updatedAt: now
      }
    })
    .returning()
    .get();
  return {
    provider: saved.provider,
    clientId: saved.clientId,
    redirectUri: saved.redirectUri,
    scopes: parseScopes(saved.scopes),
    isEnabled: saved.isEnabled,
    hasClientSecret: true,
    updatedAt: saved.updatedAt
  };
}

function settingsForRuntime() {
  const row = db.select().from(oauthProviders).where(eq(oauthProviders.provider, 'google')).get();
  if (!row || !row.isEnabled) throw new Error('Google OAuth is not configured');
  return {
    clientId: row.clientId,
    clientSecret: decryptSecret(row.clientSecretEncrypted),
    redirectUri: row.redirectUri,
    scopes: parseScopes(row.scopes)
  };
}

export function beginGoogleOauth(origin: string) {
  const config = settingsForRuntime();
  const state = crypto.randomBytes(24).toString('hex');
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', config.scopes.join(' '));
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('login_hint', '');
  url.searchParams.set('origin', origin);
  return { url: url.toString(), state, verifier };
}

export async function completeGoogleOauth(code: string, verifier: string) {
  const config = settingsForRuntime();
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier
    })
  });
  if (!tokenResponse.ok) {
    throw new Error(`Token exchange failed (${tokenResponse.status})`);
  }
  const tokens = (await tokenResponse.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!tokens.access_token || !tokens.refresh_token) {
    throw new Error('Google OAuth did not return both access and refresh tokens');
  }
  const profileResponse = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
    headers: { Authorization: `Bearer ${tokens.access_token}` }
  });
  if (!profileResponse.ok) {
    throw new Error(`Unable to fetch Gmail profile (${profileResponse.status})`);
  }
  const profile = (await profileResponse.json()) as { emailAddress: string };
  if (!profile.emailAddress) throw new Error('Missing Gmail account email');
  const now = nowIso();
  const expiresAt =
    typeof tokens.expires_in === 'number'
      ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
      : null;
  const existing = db.select().from(accounts).where(eq(accounts.email, profile.emailAddress)).get();
  const values = {
    email: profile.emailAddress,
    host: 'imap.gmail.com',
    port: 993,
    username: profile.emailAddress,
    passwordEncrypted: encryptSecret('oauth-gmail-managed'),
    smtpHost: 'smtp.gmail.com',
    smtpPort: 465,
    smtpUsername: profile.emailAddress,
    smtpPasswordEncrypted: encryptSecret('oauth-gmail-managed'),
    authType: 'oauth_gmail' as const,
    oauthProvider: 'google',
    oauthAccessTokenEncrypted: encryptSecret(tokens.access_token),
    oauthRefreshTokenEncrypted: encryptSecret(tokens.refresh_token),
    oauthAccessTokenExpiresAt: expiresAt,
    isEnabled: true,
    syncStatus: 'idle' as const,
    syncError: null,
    updatedAt: now
  };
  if (existing) {
    const updated = db
      .update(accounts)
      .set(values)
      .where(eq(accounts.id, existing.id))
      .returning()
      .get();
    return { accountId: updated.id, email: updated.email };
  }
  const created = db
    .insert(accounts)
    .values({
      ...values,
      createdAt: now
    })
    .returning()
    .get();
  return { accountId: created.id, email: created.email };
}

export async function refreshGoogleAccessToken(accountId: number) {
  const account = db.select().from(accounts).where(eq(accounts.id, accountId)).get();
  if (!account || account.authType !== 'oauth_gmail' || !account.oauthRefreshTokenEncrypted) {
    throw new Error('OAuth account refresh is unavailable');
  }
  const config = settingsForRuntime();
  const refreshToken = decryptSecret(account.oauthRefreshTokenEncrypted);
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    })
  });
  if (!tokenResponse.ok) throw new Error(`Google token refresh failed (${tokenResponse.status})`);
  const tokens = (await tokenResponse.json()) as { access_token: string; expires_in?: number };
  if (!tokens.access_token) throw new Error('Google token refresh returned no access token');
  const expiresAt =
    typeof tokens.expires_in === 'number'
      ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
      : null;
  db.update(accounts)
    .set({
      oauthAccessTokenEncrypted: encryptSecret(tokens.access_token),
      oauthAccessTokenExpiresAt: expiresAt,
      updatedAt: nowIso()
    })
    .where(eq(accounts.id, account.id))
    .run();
  return tokens.access_token;
}

export async function getGoogleAccessToken(account: typeof accounts.$inferSelect) {
  if (account.authType !== 'oauth_gmail') return null;
  const expiry = account.oauthAccessTokenExpiresAt
    ? Date.parse(account.oauthAccessTokenExpiresAt)
    : 0;
  const existing = account.oauthAccessTokenEncrypted
    ? decryptSecret(account.oauthAccessTokenEncrypted)
    : null;
  if (existing && expiry > Date.now() + 30_000) return existing;
  return refreshGoogleAccessToken(account.id);
}

function parseScopes(scopes: string) {
  try {
    const parsed = JSON.parse(scopes);
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) return parsed;
  } catch {
    // ignore
  }
  return GOOGLE_DEFAULT_SCOPES;
}
