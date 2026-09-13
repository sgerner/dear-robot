import { beforeEach, describe, expect, it, vi } from 'vitest';

const saveTokens = vi.fn();
const requestMock = vi.fn();

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
  })),
  createCodexOAuthClient: vi.fn(() => ({ request: requestMock }))
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
  beforeEach(() => requestMock.mockReset());

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

  it('sends system content as Responses instructions for OAuth requests', async () => {
    const expectedOutput = '{"ok":true}';
    requestMock.mockResolvedValueOnce(
      new Response(
        `data: ${JSON.stringify({ delta: expectedOutput })}\n\ndata: ${JSON.stringify({ type: 'response.output_text.done', text: expectedOutput })}\n\ndata: [DONE]\n`,
        { status: 200 }
      )
    );
    const { completeWithOpenAiOAuth } = await import('../src/lib/server/ai/openai-codex');

    const result = await completeWithOpenAiOAuth(
      {
        profile: 'primary',
        provider: 'openai',
        model: 'gpt-5.6-luna',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'access-token',
        envValues: {
          authType: 'openai_oauth',
          accessToken: 'access-token',
          accountId: 'account-id'
        },
        transport: 'openai_compatible'
      },
      [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Say ok.' }
      ]
    );

    expect(result).toBe(expectedOutput);
    const [, init] = requestMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.instructions).toBe('You are a helpful assistant.');
    expect(body.input).toEqual([
      { type: 'message', role: 'user', content: 'Say ok.\n\nReturn valid JSON.' }
    ]);
  });

  it('tests OAuth through the Codex Responses endpoint', async () => {
    requestMock.mockResolvedValueOnce(new Response('', { status: 200 }));
    const { testOpenAiOAuthConnection } = await import('../src/lib/server/ai/openai-codex');

    await testOpenAiOAuthConnection({
      profile: 'primary',
      provider: 'openai',
      model: 'gpt-5.6-luna',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'access-token',
      envValues: {
        authType: 'openai_oauth',
        accessToken: 'access-token',
        accountId: 'account-id'
      },
      transport: 'openai_compatible'
    });

    expect(requestMock.mock.calls[0]?.[0]).toBe('/responses');
    const [, init] = requestMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.input[0].role).toBe('user');
    expect(body.instructions).toBe('Reply with exactly OK.');
  });
});
