import { beforeEach, describe, expect, it } from 'vitest';

beforeEach(async () => {
  process.env.NODE_ENV = 'test';
  process.env.DB_PATH = ':memory:';
  process.env.APP_PASSWORD = 'test-password';
  process.env.APP_SESSION_SECRET = 'test-session-secret-test-session-secret-1234';
  process.env.ENCRYPTION_KEY = 'test-encryption-key-test-encryption-key-1234';
  const { resetForTests } = await import('../src/lib/server/db/bootstrap');
  resetForTests();
});

describe('Google OAuth start', () => {
  it('includes a login hint when reconnecting a specific account', async () => {
    const { beginGoogleOauth, upsertGoogleOauthSettings } = await import(
      '../src/lib/server/oauth/google'
    );

    upsertGoogleOauthSettings({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      redirectUri: 'http://localhost:5173/api/accounts/google/callback',
      scopes: ['openid', 'email', 'profile', 'https://mail.google.com/'],
      isEnabled: true
    });

    const { url } = beginGoogleOauth('http://localhost:5173', 'user@example.test');
    const params = new URL(url).searchParams;

    expect(params.get('login_hint')).toBe('user@example.test');
    expect(params.get('client_id')).toBe('client-id');
    expect(params.get('response_type')).toBe('code');
  });
});
