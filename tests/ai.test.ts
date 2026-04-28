import { describe, expect, it } from 'vitest';

describe('AI suggestion layer', () => {
  it('returns valid deterministic suggestions without an API key', async () => {
    process.env.AI_PROVIDER = 'mock';
    process.env.AI_API_KEY = '';
    const { generateEmailSuggestion } = await import('../src/lib/server/ai/provider');
    const { EmailSuggestionSchema } = await import('../src/lib/server/ai/schema');
    const result = await generateEmailSuggestion({
      agentInstructions: 'Move newsletters to Newsletters. Suspicious emails to Spam Review.',
      subject: 'Urgent password expiration',
      sender: 'bad@example.invalid',
      recipients: 'me@example.test',
      date: '2026-04-22T10:00:00Z',
      bodyText: 'Click http://fake.invalid/login now',
      availableFolders: ['INBOX', 'Spam Review']
    });
    expect(result.provider).toBe('mock');
    expect(EmailSuggestionSchema.parse(result.suggestion).recommended_action).toBe('spam');
  });
});
