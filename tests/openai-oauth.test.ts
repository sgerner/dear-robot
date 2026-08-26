import { describe, expect, it, vi } from 'vitest';

const saveTokens = vi.fn();

vi.mock('openai-codex-oauth', () => ({
  startOpenAIDeviceFlow: vi.fn(async (options: { tokenStore?: { save: (tokens: unknown) => Promise<void> } }) => ({
    providerId: 'openai',
    url: 'https://auth.openai.com/codex/device',
    code: 'TEST-CODE',
    instructions: 'Enter code: TEST-CODE',
    complete: async () => {
      const tokens = {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        accountId: 'account-id'
      };
      await options.tokenStore?.save(tokens);
      return tokens;
    }
  }))
}));

vi.mock('../src/lib/server/ai/settings', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/server/ai/settings')>(
    '../src/lib/server/ai/settings'
  );
  return {
    ...actual,
    saveOpenAiOAuthTokens: saveTokens
  };
});

describe('OpenAI device login', () => {
  it('starts the device flow and persists returned OAuth tokens server-side', async () => {
    const { openAiLoginStatus, startOpenAiLogin } = await import(
      '../src/lib/server/ai/openai-codex'
    );
    const started = await startOpenAiLogin('advanced');

    expect(started.status).toBe('pending');
    expect(started.authorizationUrl).toBe('https://auth.openai.com/codex/device');
    expect(started.code).toBe('TEST-CODE');

    await vi.waitFor(() => expect(saveTokens).toHaveBeenCalledOnce());
    expect(openAiLoginStatus('advanced').status).toBe('connected');
    expect(saveTokens).toHaveBeenCalledWith(
      'advanced',
      expect.objectContaining({ accessToken: 'access-token', accountId: 'account-id' })
    );
  });
});
