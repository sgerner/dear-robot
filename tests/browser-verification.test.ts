import { describe, expect, it } from 'vitest';
import { verificationCodeFromMessage } from '../src/lib/server/browser-verification';

describe('browser inbox verification', () => {
  const input = {
    email: 'reports@example.test',
    hosts: ['doordash.com'],
    since: Date.now() - 60000
  };
  const message = {
    from: 'DoorDash <no-reply@doordash.com>',
    to: 'reports@example.test',
    subject: 'Your verification code',
    bodyText: 'Enter 123456 to sign in.',
    date: new Date().toISOString()
  };
  it('accepts a fresh, uniquely identified code for the configured recipient and service', () => {
    expect(verificationCodeFromMessage(message, input)).toBe('123456');
  });
  it('extracts the labelled code without confusing footer years or phone numbers', () => {
    expect(
      verificationCodeFromMessage(
        {
          ...message,
          bodyText: 'Your verification code is 123456. Copyright 2026. Call 800-555-1234.'
        },
        input
      )
    ).toBe('123456');
  });
  it('rejects stale, misaddressed, unrelated and ambiguous messages', () => {
    for (const change of [
      { date: '2020-01-01' },
      { to: 'someone@example.test' },
      { from: 'DoorDash <no-reply@doordash.com.evil.test>' },
      { bodyText: '123456 or 654321' },
      { subject: 'Invoice', bodyText: 'Total 123456' }
    ])
      expect(verificationCodeFromMessage({ ...message, ...change }, input)).toBeNull();
  });
});
