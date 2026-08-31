import { createRequire } from 'node:module';
import type { OpenAIDeviceFlow, OpenAIOAuthTokens } from 'openai-codex-oauth';
import {
  hasOpenAiOAuthTokens,
  saveOpenAiOAuthTokens,
  type AiProfileInput,
  type OpenAiOAuthTokens as StoredOpenAiOAuthTokens
} from './settings';
import type { ProviderConfig } from './provider';

// The OAuth package is CommonJS and pulls optional AI SDK peers from its root
// entrypoint. Loading it through Node avoids adapter-node folding those peers
// into the ESM server bundle, where their Zod interop breaks at startup.
const require = createRequire(import.meta.url);

type OAuthModule = typeof import('openai-codex-oauth');

async function loadOAuthModule(): Promise<OAuthModule> {
  if (process.env.NODE_ENV === 'test') {
    return import('openai-codex-oauth');
  }
  return require('openai-codex-oauth') as OAuthModule;
}

type LoginProfile = Exclude<AiProfileInput['profile'], 'audio'>;

export type AgentToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type AgentToolCall = {
  id: string;
  name: string;
  arguments: string;
};

type LoginState = {
  profile: LoginProfile;
  flow: OpenAIDeviceFlow;
  status: 'pending' | 'connected' | 'error';
  error: string | null;
  promise: Promise<void>;
};

const loginStates = new Map<LoginProfile, LoginState>();

function publicLoginState(state: LoginState) {
  return {
    profile: state.profile,
    status: state.status,
    authorizationUrl: state.flow.url,
    code: state.flow.code,
    instructions: state.flow.instructions,
    error: state.error
  };
}

export async function startOpenAiLogin(profile: LoginProfile) {
  const existing = loginStates.get(profile);
  if (existing?.status === 'pending') return publicLoginState(existing);

  const { startOpenAIDeviceFlow } = await loadOAuthModule();
  const flow = await startOpenAIDeviceFlow({
    tokenStore: {
      load: async () => undefined,
      save: async (tokens) => saveOpenAiOAuthTokens(profile, tokens)
    }
  });

  const state: LoginState = {
    profile,
    flow,
    status: 'pending' as const,
    error: null,
    promise: Promise.resolve()
  };
  state.promise = flow
    .complete()
    .then(() => {
      state.status = 'connected';
    })
    .catch((error: unknown) => {
      state.status = 'error';
      state.error = error instanceof Error ? error.message : String(error);
    });
  loginStates.set(profile, state);
  return publicLoginState(state);
}

export function openAiLoginStatus(profile: LoginProfile) {
  const pending = loginStates.get(profile);
  if (pending) return publicLoginState(pending);
  return {
    profile,
    status: hasOpenAiOAuthTokens(profile) ? ('connected' as const) : ('idle' as const),
    authorizationUrl: null,
    code: null,
    instructions: null,
    error: null
  };
}

function oauthTokensFromConfig(config: ProviderConfig): StoredOpenAiOAuthTokens | null {
  const values = config.envValues as Record<string, unknown> | undefined;
  if (
    values?.authType !== 'openai_oauth' ||
    typeof values.accessToken !== 'string' ||
    typeof values.accountId !== 'string'
  ) {
    return null;
  }
  return {
    accessToken: values.accessToken,
    refreshToken: typeof values.refreshToken === 'string' ? values.refreshToken : undefined,
    expiresAt: typeof values.expiresAt === 'number' ? values.expiresAt : undefined,
    idToken: typeof values.idToken === 'string' ? values.idToken : undefined,
    accountId: values.accountId
  };
}

export function isOpenAiOAuthConfig(config: ProviderConfig) {
  return Boolean(oauthTokensFromConfig(config));
}

export async function completeWithOpenAiOAuth(
  config: ProviderConfig,
  messages: Array<{
    role: string;
    content: string;
    toolCallId?: string;
    name?: string;
    toolCalls?: AgentToolCall[];
  }>
) {
  const tokens = oauthTokensFromConfig(config);
  if (!tokens) throw new Error('OpenAI OAuth is not connected for this profile');
  if (!config.profile || config.profile === 'audio') {
    throw new Error('OpenAI OAuth requires a primary, fallback, or advanced AI profile');
  }

  const { createCodexOAuthClient } = await loadOAuthModule();
  const client = createCodexOAuthClient({
    tokens,
    onTokens: async (refreshed: OpenAIOAuthTokens) => {
      await saveOpenAiOAuthTokens(config.profile as LoginProfile, refreshed);
    }
  });
  const response = await client.request('/responses', {
    method: 'POST',
    headers: {
      accept: 'text/event-stream',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: config.model,
      input: messages.map((message) => ({
        type: 'message',
        role: message.role,
        content: message.content
      })),
      stream: true,
      store: false,
      text: { format: { type: 'json_object' } }
    })
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`openai ${response.status}: ${body.slice(0, 300)}`);
  return extractResponseText(body);
}

/** A non-streaming Responses call used by the bounded agent loop. */
export async function completeWithOpenAiOAuthTools(
  config: ProviderConfig,
  messages: Array<{
    role: string;
    content: string;
    toolCallId?: string;
    name?: string;
    toolCalls?: AgentToolCall[];
  }>,
  tools: AgentToolDefinition[]
) {
  const tokens = oauthTokensFromConfig(config);
  if (!tokens) throw new Error('OpenAI OAuth is not connected for this profile');
  if (!config.profile || config.profile === 'audio') {
    throw new Error('OpenAI OAuth requires a primary, fallback, or advanced AI profile');
  }
  const { createCodexOAuthClient } = await loadOAuthModule();
  const client = createCodexOAuthClient({
    tokens,
    onTokens: async (refreshed: OpenAIOAuthTokens) => {
      await saveOpenAiOAuthTokens(config.profile as LoginProfile, refreshed);
    }
  });
  const response = await client.request('/responses', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: config.model,
      input: toResponsesInput(messages),
      tools: tools.map((tool) => ({
        type: 'function',
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        strict: false
      })),
      tool_choice: 'auto',
      store: false
    })
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`openai ${response.status}: ${body.slice(0, 300)}`);
  const parsed = JSON.parse(body) as Record<string, unknown>;
  const output = Array.isArray(parsed.output) ? parsed.output : [];
  const toolCalls: AgentToolCall[] = [];
  const text: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    if (row.type === 'function_call' && typeof row.name === 'string') {
      toolCalls.push({
        id: typeof row.call_id === 'string' ? row.call_id : `call_${toolCalls.length + 1}`,
        name: row.name,
        arguments: typeof row.arguments === 'string' ? row.arguments : '{}'
      });
    }
    if (row.type === 'message' && Array.isArray(row.content)) {
      for (const part of row.content) {
        if (part && typeof part === 'object' && typeof (part as Record<string, unknown>).text === 'string')
          text.push((part as Record<string, unknown>).text as string);
      }
    }
  }
  if (typeof parsed.output_text === 'string') text.push(parsed.output_text);
  return { content: text.join(''), toolCalls };
}

/**
 * Responses keeps function calls and their outputs as first-class input
 * items.  Converting them to Chat Completions-style `tool` messages makes an
 * OAuth-backed Responses request fail on the second turn, so preserve the
 * native item shape here.
 */
function toResponsesInput(
  messages: Array<{
    role: string;
    content: string;
    toolCallId?: string;
    name?: string;
    toolCalls?: AgentToolCall[];
  }>
) {
  return messages.flatMap((message) => {
    if (message.role === 'tool' && message.toolCallId) {
      return [
        {
          type: 'function_call_output',
          call_id: message.toolCallId,
          output: message.content
        }
      ];
    }
    const items: Array<Record<string, unknown>> = [];
    if (message.content.trim()) {
      items.push({ type: 'message', role: message.role, content: message.content });
    }
    for (const call of message.toolCalls || []) {
      items.push({
        type: 'function_call',
        call_id: call.id,
        name: call.name,
        arguments: call.arguments
      });
    }
    return items;
  });
}

function extractResponseText(body: string) {
  const deltas: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    const raw = line.slice(5).trim();
    if (!raw || raw === '[DONE]') continue;
    try {
      const event = JSON.parse(raw) as Record<string, unknown>;
      if (typeof event.delta === 'string') deltas.push(event.delta);
      collectOutputText(event, deltas);
    } catch {
      // Ignore non-JSON keepalive lines in the SSE stream.
    }
  }
  if (deltas.length) return deltas.join('');

  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const output: string[] = [];
    collectOutputText(parsed, output);
    if (output.length) return output.join('');
  } catch {
    // The caller will receive a useful provider error for an empty response.
  }
  throw new Error('openai returned no response text');
}

function collectOutputText(value: unknown, output: string[]) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item) => collectOutputText(item, output));
    return;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.text === 'string') output.push(record.text);
  if (record.output) collectOutputText(record.output, output);
  if (record.content) collectOutputText(record.content, output);
}
